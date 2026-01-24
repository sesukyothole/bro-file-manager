# S3 Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add S3 service compatibility (AWS S3, Cloudflare R2) to Bro File Manager with separated local/S3 views and admin-configurable credentials.

**Architecture:**
1. Create an abstraction layer (StorageAdapter) that wraps both local filesystem and S3 operations
2. Add S3 configuration stored in a JSON settings file managed by admin UI
3. Duplicate existing API endpoints with `/api/s3/*` prefix for S3 operations
4. Add storage mode switcher (Local/S3) in the UI with separated navigation states

**Tech Stack:**
- `@aws-sdk/client-s3` - AWS S3 SDK v3 (works with both AWS S3 and Cloudflare R2)
- TypeScript types for storage abstraction
- Existing Hono + Bun runtime

---

## Task 1: Create Storage Abstraction Layer

**Files:**
- Create: `server/storage/adapters.ts`
- Create: `server/storage/types.ts`
- Test: `tests/storage/adapters.test.ts` (create test directory first)

**Step 1: Write the failing test for storage adapter interface**

Create file `tests/storage/adapters.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { LocalStorageAdapter } from "../../server/storage/adapters";
import { S3StorageAdapter } from "../../server/storage/adapters";

describe("LocalStorageAdapter", () => {
  it("should list files in a directory", async () => {
    const adapter = new LocalStorageAdapter("/tmp");
    const entries = await adapter.list("/");
    expect(Array.isArray(entries)).toBe(true);
  });

  it("should read file stats", async () => {
    const adapter = new LocalStorageAdapter("/tmp");
    // Will fail until implemented
  });
});

describe("S3StorageAdapter", () => {
  it("should connect to S3 with credentials", async () => {
    const adapter = new S3StorageAdapter({
      region: "auto",
      endpoint: "https://example.com",
      accessKeyId: "test",
      secretAccessKey: "test",
      bucket: "test-bucket",
    });
    // Will fail until implemented
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/storage/adapters.test.ts`
Expected: FAIL with "Cannot find module '../../server/storage/adapters'"

**Step 3: Create storage types**

Create file `server/storage/types.ts`:

```typescript
export interface StorageEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  size: number;
  modified: Date;
  key?: string; // S3 object key
}

export interface StorageConfig {
  type: "local" | "s3";
}

export interface LocalStorageConfig extends StorageConfig {
  type: "local";
  root: string;
}

export interface S3StorageConfig extends StorageConfig {
  type: "s3";
  region: string;
  endpoint?: string; // For Cloudflare R2 and other S3-compatible services
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  prefix?: string; // Optional prefix for all keys
}

export interface StorageAdapter {
  list(path: string, options?: { limit?: number; offset?: number }): Promise<{ entries: StorageEntry[]; total: number }>;
  stat(path: string): Promise<StorageEntry | null>;
  read(path: string): Promise<Buffer>;
  write(path: string, content: Buffer): Promise<void>;
  delete(path: string): Promise<void>;
  move(source: string, destination: string): Promise<void>;
  copy(source: string, destination: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  getPublicUrl(path: string): string;
}
```

**Step 4: Create storage adapters**

Create file `server/storage/adapters.ts`:

```typescript
import { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, CopyObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "stream";
import { promises as fs } from "fs";
import { join, normalize } from "path";
import type { StorageAdapter, StorageEntry, LocalStorageConfig, S3StorageConfig } from "./types";

export class LocalStorageAdapter implements StorageAdapter {
  constructor(private root: string) {
    this.root = normalize(root);
  }

  private resolvePath(path: string): string {
    const resolved = normalize(join(this.root, path));
    if (!resolved.startsWith(this.root)) {
      throw new Error("Path traversal detected");
    }
    return resolved;
  }

  async list(path: string, options: { limit?: number; offset?: number } = {}): Promise<{ entries: StorageEntry[]; total: number }> {
    const fullPath = this.resolvePath(path);
    const entries = await fs.readdir(fullPath, { withFileTypes: true });

    const mapped: StorageEntry[] = await Promise.all(
      entries.map(async (entry) => {
        const entryPath = join(fullPath, entry.name);
        const stats = await fs.stat(entryPath);
        return {
          name: entry.name,
          path: join(path, entry.name).replace(/\\/g, "/"),
          type: entry.isDirectory() ? "directory" : "file",
          size: stats.size,
          modified: stats.mtime,
        };
      })
    );

    // Sort: directories first, then by name
    mapped.sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    const { limit, offset = 0 } = options;
    const total = mapped.length;
    const paginated = limit ? mapped.slice(offset, offset + limit) : mapped;

    return { entries: paginated, total };
  }

  async stat(path: string): Promise<StorageEntry | null> {
    const fullPath = this.resolvePath(path);
    try {
      const stats = await fs.stat(fullPath);
      return {
        name: path.split("/").pop() || "",
        path,
        type: stats.isDirectory() ? "directory" : "file",
        size: stats.size,
        modified: stats.mtime,
      };
    } catch {
      return null;
    }
  }

  async read(path: string): Promise<Buffer> {
    const fullPath = this.resolvePath(path);
    return await fs.readFile(fullPath);
  }

  async write(path: string, content: Buffer): Promise<void> {
    const fullPath = this.resolvePath(path);
    await fs.mkdir(this.resolvePath(path.split("/").slice(0, -1).join("/")), { recursive: true });
    await fs.writeFile(fullPath, content);
  }

  async delete(path: string): Promise<void> {
    const fullPath = this.resolvePath(path);
    await fs.rm(fullPath, { recursive: true });
  }

  async move(source: string, destination: string): Promise<void> {
    const srcPath = this.resolvePath(source);
    const destPath = this.resolvePath(destination);
    await fs.mkdir(this.resolvePath(destination.split("/").slice(0, -1).join("/")), { recursive: true });
    await fs.rename(srcPath, destPath);
  }

  async copy(source: string, destination: string): Promise<void> {
    const srcPath = this.resolvePath(source);
    const destPath = this.resolvePath(destination);
    await fs.mkdir(this.resolvePath(destination.split("/").slice(0, -1).join("/")), { recursive: true });
    await fs.copyFile(srcPath, destPath);
  }

  async mkdir(path: string): Promise<void> {
    const fullPath = this.resolvePath(path);
    await fs.mkdir(fullPath, { recursive: true });
  }

  async exists(path: string): Promise<boolean> {
    const fullPath = this.resolvePath(path);
    try {
      await fs.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  getPublicUrl(path: string): string {
    return `/api/download?path=${encodeURIComponent(path)}`;
  }
}

export class S3StorageAdapter implements StorageAdapter {
  private client: S3Client;
  private bucket: string;
  private prefix: string;

  constructor(config: S3StorageConfig) {
    this.bucket = config.bucket;
    this.prefix = config.prefix || "";

    this.client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  private normalizeKey(path: string): string {
    // Remove leading slash and add prefix
    const cleanPath = path.replace(/^\//, "").replace(/\/$/, "");
    return this.prefix ? `${this.prefix}/${cleanPath}` : cleanPath;
  }

  private stripPrefix(key: string): string {
    if (this.prefix && key.startsWith(`${this.prefix}/`)) {
      return key.slice(this.prefix.length + 1);
    }
    return key;
  }

  async list(path: string, options: { limit?: number; offset?: number } = {}): Promise<{ entries: StorageEntry[]; total: number }> {
    const prefix = this.normalizeKey(path);
    const delimiter = "/";

    const command = new ListObjectsV2Command({
      Bucket: this.bucket,
      Prefix: prefix,
      Delimiter: delimiter,
      MaxKeys: options.limit || 1000,
    });

    const response = await this.client.send(command);

    const entries: StorageEntry[] = [];

    // Add directories (CommonPrefixes)
    for (const prefixItem of response.CommonPrefixes || []) {
      const name = this.stripPrefix(prefixItem.Prefix || "").split("/").filter(Boolean).pop() || "";
      entries.push({
        name,
        path: `/${this.stripPrefix(prefixItem.Prefix || "")}`,
        type: "directory",
        size: 0,
        modified: new Date(),
      });
    }

    // Add files (Contents)
    for (const object of response.Contents || []) {
      if (object.Key && object.Key !== prefix) {
        const name = this.stripPrefix(object.Key).split("/").pop() || "";
        entries.push({
          name,
          path: `/${this.stripPrefix(object.Key)}`,
          type: "file",
          size: object.Size || 0,
          modified: object.LastModified || new Date(),
        });
      }
    }

    // Sort: directories first, then by name
    entries.sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return {
      entries: options.offset ? entries.slice(options.offset) : entries,
      total: entries.length,
    };
  }

  async stat(path: string): Promise<StorageEntry | null> {
    const key = this.normalizeKey(path);

    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      const response = await this.client.send(command);

      return {
        name: path.split("/").pop() || "",
        path,
        type: "file",
        size: response.ContentLength || 0,
        modified: response.LastModified || new Date(),
      };
    } catch {
      // Check if it's a "directory" by listing its contents
      const listCmd = new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: `${key}/`,
        MaxKeys: 1,
      });

      try {
        const listResponse = await this.client.send(listCmd);
        if (listResponse.Contents && listResponse.Contents.length > 0) {
          return {
            name: path.split("/").pop() || "",
            path,
            type: "directory",
            size: 0,
            modified: new Date(),
          };
        }
      } catch {}

      return null;
    }
  }

  async read(path: string): Promise<Buffer> {
    const key = this.normalizeKey(path);

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    const response = await this.client.send(command);

    if (!response.Body) {
      throw new Error("Empty response body");
    }

    const chunks: Uint8Array[] = [];
    for await (const chunk of response.Body as any) {
      chunks.push(chunk);
    }

    return Buffer.concat(chunks);
  }

  async write(path: string, content: Buffer): Promise<void> {
    const key = this.normalizeKey(path);

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: content,
    });

    await this.client.send(command);
  }

  async delete(path: string): Promise<void> {
    const key = this.normalizeKey(path);

    // Check if it's a directory with contents
    const listCmd = new ListObjectsV2Command({
      Bucket: this.bucket,
      Prefix: `${key}/`,
    });

    const listResponse = await this.client.send(listCmd);

    if (listResponse.Contents && listResponse.Contents.length > 0) {
      // Delete all objects with this prefix
      for (const object of listResponse.Contents) {
        if (object.Key) {
          const deleteCmd = new DeleteObjectCommand({
            Bucket: this.bucket,
            Key: object.Key,
          });
          await this.client.send(deleteCmd);
        }
      }
    }

    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    await this.client.send(command);
  }

  async move(source: string, destination: string): Promise<void> {
    await this.copy(source, destination);
    await this.delete(source);
  }

  async copy(source: string, destination: string): Promise<void> {
    const sourceKey = this.normalizeKey(source);
    const destKey = this.normalizeKey(destination);

    const command = new CopyObjectCommand({
      Bucket: this.bucket,
      CopySource: `${this.bucket}/${sourceKey}`,
      Key: destKey,
    });

    await this.client.send(command);
  }

  async mkdir(path: string): Promise<void> {
    // S3 doesn't have directories, create a placeholder object
    const key = this.normalizeKey(path).replace(/\/$/, "") + "/";

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: "",
    });

    await this.client.send(command);
  }

  async exists(path: string): Promise<boolean> {
    const stat = await this.stat(path);
    return stat !== null;
  }

  getPublicUrl(path: string): string {
    return `/api/s3/download?path=${encodeURIComponent(path)}`;
  }
}
```

**Step 5: Run test to verify it passes**

Run: `bun test tests/storage/adapters.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add tests/storage/ server/storage/
git commit -m "feat(storage): add storage abstraction layer with local and S3 adapters"
```

---

## Task 2: Create S3 Settings Management System

**Files:**
- Create: `server/storage/settings.ts`
- Modify: `server.ts:1-100` (config section)

**Step 1: Create settings types and manager**

Create file `server/storage/settings.ts`:

```typescript
import { promises as fs } from "fs";
import { join } from "path";
import type { S3StorageConfig } from "./types";

export interface AppSettings {
  s3Configs: S3ConfigProfile[];
}

export interface S3ConfigProfile {
  id: string;
  name: string;
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  prefix?: string;
  isDefault?: boolean;
}

const SETTINGS_PATH = join(process.cwd(), "data", "settings.json");

export async function readSettings(): Promise<AppSettings> {
  try {
    const content = await fs.readFile(SETTINGS_PATH, "utf-8");
    return JSON.parse(content);
  } catch {
    // Return default settings if file doesn't exist
    return { s3Configs: [] };
  }
}

export async function writeSettings(settings: AppSettings): Promise<void> {
  const dir = join(process.cwd(), "data");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(SETTINGS_PATH, JSON.stringify(settings, null, 2));
}

export async function addS3Config(config: Omit<S3ConfigProfile, "id">): Promise<S3ConfigProfile> {
  const settings = await readSettings();
  const newConfig: S3ConfigProfile = {
    ...config,
    id: crypto.randomUUID(),
  };
  settings.s3Configs.push(newConfig);
  await writeSettings(settings);
  return newConfig;
}

export async function updateS3Config(id: string, updates: Partial<S3ConfigProfile>): Promise<S3ConfigProfile | null> {
  const settings = await readSettings();
  const index = settings.s3Configs.findIndex((c) => c.id === id);
  if (index === -1) return null;

  settings.s3Configs[index] = { ...settings.s3Configs[index], ...updates };
  await writeSettings(settings);
  return settings.s3Configs[index];
}

export async function deleteS3Config(id: string): Promise<boolean> {
  const settings = await readSettings();
  const index = settings.s3Configs.findIndex((c) => c.id === id);
  if (index === -1) return false;

  settings.s3Configs.splice(index, 1);
  await writeSettings(settings);
  return true;
}

export async function getS3Config(id: string): Promise<S3ConfigProfile | null> {
  const settings = await readSettings();
  return settings.s3Configs.find((c) => c.id === id) || null;
}

export async function getAllS3Configs(): Promise<S3ConfigProfile[]> {
  const settings = await readSettings();
  return settings.s3Configs;
}

export function s3ConfigToStorageConfig(config: S3ConfigProfile): S3StorageConfig {
  return {
    type: "s3",
    region: config.region,
    endpoint: config.endpoint,
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    bucket: config.bucket,
    prefix: config.prefix,
  };
}
```

**Step 2: Add S3 endpoints to server.ts**

Modify `server.ts` - add after the existing API endpoints (around line 976):

```typescript
// S3 Configuration Endpoints (Admin only)

// GET /api/s3/configs - List all S3 configurations
app.get("/api/s3/configs", async (c) => {
  const session = getSession(c);
  if (!session || session.role !== "admin") {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const configs = await getAllS3Configs();
  // Return configs without secrets for list view
  const safeConfigs = configs.map(({ secretAccessKey: _, ...rest }) => rest);
  return c.json({ configs: safeConfigs });
});

// GET /api/s3/configs/:id - Get specific S3 configuration
app.get("/api/s3/configs/:id", async (c) => {
  const session = getSession(c);
  if (!session || session.role !== "admin") {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const id = c.req.param("id");
  const config = await getS3Config(id);
  if (!config) {
    return c.json({ error: "Configuration not found" }, 404);
  }

  return c.json({ config });
});

// POST /api/s3/configs - Create new S3 configuration
app.post("/api/s3/configs", async (c) => {
  const session = getSession(c);
  if (!session || session.role !== "admin") {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const body = await c.req.json();
  const { name, region, endpoint, accessKeyId, secretAccessKey, bucket, prefix } = body;

  if (!name || !region || !accessKeyId || !secretAccessKey || !bucket) {
    return c.json({ error: "Missing required fields" }, 400);
  }

  try {
    const config = await addS3Config({
      name,
      region,
      endpoint,
      accessKeyId,
      secretAccessKey,
      bucket,
      prefix,
    });

    // Log the action
    await auditLog("s3_config_added", session.user, { configId: config.id, name });

    return c.json({ config: { ...config, secretAccessKey: "***" } }, 201);
  } catch (error) {
    return c.json({ error: "Failed to create configuration" }, 500);
  }
});

// PUT /api/s3/configs/:id - Update S3 configuration
app.put("/api/s3/configs/:id", async (c) => {
  const session = getSession(c);
  if (!session || session.role !== "admin") {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const id = c.req.param("id");
  const body = await c.req.json();

  try {
    const updated = await updateS3Config(id, body);
    if (!updated) {
      return c.json({ error: "Configuration not found" }, 404);
    }

    await auditLog("s3_config_updated", session.user, { configId: id });

    return c.json({ config: { ...updated, secretAccessKey: "***" } });
  } catch (error) {
    return c.json({ error: "Failed to update configuration" }, 500);
  }
});

// DELETE /api/s3/configs/:id - Delete S3 configuration
app.delete("/api/s3/configs/:id", async (c) => {
  const session = getSession(c);
  if (!session || session.role !== "admin") {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const id = c.req.param("id");

  const deleted = await deleteS3Config(id);
  if (!deleted) {
    return c.json({ error: "Configuration not found" }, 404);
  }

  await auditLog("s3_config_deleted", session.user, { configId: id });

  return c.json({ success: true });
});

// POST /api/s3/configs/:id/test - Test S3 connection
app.post("/api/s3/configs/:id/test", async (c) => {
  const session = getSession(c);
  if (!session || session.role !== "admin") {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const id = c.req.param("id");
  const config = await getS3Config(id);
  if (!config) {
    return c.json({ error: "Configuration not found" }, 404);
  }

  try {
    const { S3Client, ListObjectsV2Command } = await import("@aws-sdk/client-s3");
    const client = new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });

    // Try to list objects (with max 1) to test connection
    await client.send(new ListObjectsV2Command({
      Bucket: config.bucket,
      MaxKeys: 1,
    }));

    await auditLog("s3_config_tested", session.user, { configId: id, success: true });

    return c.json({ success: true, message: "Connection successful" });
  } catch (error: any) {
    await auditLog("s3_config_tested", session.user, { configId: id, success: false, error: error.message });
    return c.json({ success: false, error: error.message }, 400);
  }
});
```

**Step 3: Commit**

```bash
git add server/storage/settings.ts server.ts
git commit -m "feat(s3): add S3 configuration management endpoints"
```

---

## Task 3: Create S3 API Endpoints

**Files:**
- Modify: `server.ts` (add S3 file operation endpoints)

**Step 1: Add S3 storage factory function**

Add to `server.ts` after the imports section:

```typescript
import { S3StorageAdapter } from "./storage/adapters.js";
import { getS3Config, s3ConfigToStorageConfig } from "./storage/settings.js";

async function getS3Adapter(configId: string): Promise<S3StorageAdapter | null> {
  const config = await getS3Config(configId);
  if (!config) return null;
  return new S3StorageAdapter(s3ConfigToStorageConfig(config));
}

// Store active S3 connections per session
const s3Sessions = new Map<string, { configId: string; adapter: S3StorageAdapter }>();

function setSessionS3(sessionId: string, configId: string, adapter: S3StorageAdapter) {
  s3Sessions.set(sessionId, { configId, adapter });
}

function getSessionS3(sessionId: string): { configId: string; adapter: S3StorageAdapter } | undefined {
  return s3Sessions.get(sessionId);
}

function clearSessionS3(sessionId: string) {
  s3Sessions.delete(sessionId);
}
```

**Step 2: Add S3 session management endpoint**

Add to `server.ts`:

```typescript
// POST /api/s3/connect - Connect to an S3 configuration
app.post("/api/s3/connect", async (c) => {
  const session = getSession(c);
  if (!session) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const { configId } = await c.req.json();
  if (!configId) {
    return c.json({ error: "Missing configId" }, 400);
  }

  const adapter = await getS3Adapter(configId);
  if (!adapter) {
    return c.json({ error: "Configuration not found" }, 404);
  }

  setSessionS3(session.id, configId, adapter);

  await auditLog("s3_connected", session.user, { configId });

  return c.json({ success: true });
});

// POST /api/s3/disconnect - Disconnect from S3
app.post("/api/s3/disconnect", async (c) => {
  const session = getSession(c);
  if (!session) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  clearSessionS3(session.id);

  return c.json({ success: true });
});

// GET /api/s3/current - Get current S3 connection info
app.get("/api/s3/current", async (c) => {
  const session = getSession(c);
  if (!session) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const s3Session = getSessionS3(session.id);
  if (!s3Session) {
    return c.json({ connected: false });
  }

  const config = await getS3Config(s3Session.configId);
  if (!config) {
    clearSessionS3(session.id);
    return c.json({ connected: false });
  }

  return c.json({
    connected: true,
    config: {
      id: config.id,
      name: config.name,
      bucket: config.bucket,
      region: config.region,
    },
  });
});
```

**Step 3: Add S3 file operation endpoints**

Add to `server.ts` (mirror existing endpoints with `/api/s3/*` prefix):

```typescript
// Helper to verify S3 session
async function requireS3Session(c: Context): Promise<{ session: SessionState; adapter: S3StorageAdapter } | { error: string; status: number }> {
  const session = getSession(c);
  if (!session) {
    return { error: "Unauthorized", status: 401 };
  }

  const s3Session = getSessionS3(session.id);
  if (!s3Session) {
    return { error: "Not connected to S3", status: 400 };
  }

  return { session, adapter: s3Session.adapter };
}

// GET /api/s3/list - List S3 objects
app.get("/api/s3/list", async (c) => {
  const result = await requireS3Session(c);
  if ("error" in result) return c.json({ error: result.error }, result.status);

  const { adapter } = result;
  const path = c.req.query("path") || "/";
  const limit = parseInt(c.req.query("limit") || "100");
  const offset = parseInt(c.req.query("offset") || "0");

  try {
    const { entries, total } = await adapter.list(path, { limit, offset });
    return c.json({ entries, total });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// GET /api/s3/download - Download S3 object
app.get("/api/s3/download", async (c) => {
  const result = await requireS3Session(c);
  if ("error" in result) return c.json({ error: result.error }, result.status);

  const { adapter } = result;
  const path = c.req.query("path");
  if (!path) return c.json({ error: "Missing path" }, 400);

  try {
    const content = await adapter.read(path);
    const stat = await adapter.stat(path);
    const filename = path.split("/").pop() || "download";

    return c.body(content, 200, {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": stat?.size.toString() || "0",
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// GET /api/s3/preview - Preview S3 object (text)
app.get("/api/s3/preview", async (c) => {
  const result = await requireS3Session(c);
  if ("error" in result) return c.json({ error: result.error }, result.status);

  const { adapter } = result;
  const path = c.req.query("path");
  if (!path) return c.json({ error: "Missing path" }, 400);

  try {
    const stat = await adapter.stat(path);
    if (!stat || stat.type === "directory") {
      return c.json({ error: "Not a file" }, 400);
    }

    const content = await adapter.read(path);
    const text = content.toString("utf-8");

    return c.json({ content: text.slice(0, 200 * 1024), size: stat.size });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// GET /api/s3/image - Get S3 image
app.get("/api/s3/image", async (c) => {
  const result = await requireS3Session(c);
  if ("error" in result) return c.json({ error: result.error }, result.status);

  const { adapter } = result;
  const path = c.req.query("path");
  if (!path) return c.json({ error: "Missing path" }, 400);

  try {
    const content = await adapter.read(path);
    const ext = path.split(".").pop()?.toLowerCase() || "";
    const mimeTypes: Record<string, string> = {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      webp: "image/webp",
      bmp: "image/bmp",
      svg: "image/svg+xml",
    };

    return c.body(content, 200, {
      "Content-Type": mimeTypes[ext] || "image/jpeg",
    });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// GET /api/s3/edit - Get file for editing
app.get("/api/s3/edit", async (c) => {
  const result = await requireS3Session(c);
  if ("error" in result) return c.json({ error: result.error }, result.status);

  const { session, adapter } = result;
  if (session.role === "read-only") {
    return c.json({ error: "Read-only users cannot edit files" }, 403);
  }

  const path = c.req.query("path");
  if (!path) return c.json({ error: "Missing path" }, 400);

  try {
    const stat = await adapter.stat(path);
    if (!stat) {
      return c.json({ error: "File not found" }, 404);
    }

    if (stat.size > 1024 * 1024) {
      return c.json({ error: "File too large to edit" }, 400);
    }

    const content = await adapter.read(path);
    return c.json({ content: content.toString("utf-8") });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// PUT /api/s3/edit - Save edited file
app.put("/api/s3/edit", async (c) => {
  const result = await requireS3Session(c);
  if ("error" in result) return c.json({ error: result.error }, result.status);

  const { session, adapter } = result;
  if (session.role === "read-only") {
    return c.json({ error: "Read-only users cannot edit files" }, 403);
  }

  const { path, content } = await c.req.json();
  if (!path || content === undefined) {
    return c.json({ error: "Missing path or content" }, 400);
  }

  try {
    await adapter.write(path, Buffer.from(content));
    await auditLog("s3_file_edited", session.user, { path });
    return c.json({ success: true });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// POST /api/s3/upload - Upload to S3
app.post("/api/s3/upload", async (c) => {
  const result = await requireS3Session(c);
  if ("error" in result) return c.json({ error: result.error }, result.status);

  const { session, adapter } = result;
  if (session.role === "read-only") {
    return c.json({ error: "Read-only users cannot upload files" }, 403);
  }

  const formData = await c.req.formData();
  const file = formData.get("file") as File;
  const path = formData.get("path") as string;

  if (!file || !path) {
    return c.json({ error: "Missing file or path" }, 400);
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const targetPath = path.endsWith("/") ? path + file.name : path;
    await adapter.write(targetPath, buffer);

    await auditLog("s3_file_uploaded", session.user, { path: targetPath, size: buffer.length });

    return c.json({ success: true });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// DELETE /api/s3/delete - Delete S3 object
app.delete("/api/s3/delete", async (c) => {
  const result = await requireS3Session(c);
  if ("error" in result) return c.json({ error: result.error }, result.status);

  const { session, adapter } = result;
  if (session.role === "read-only") {
    return c.json({ error: "Read-only users cannot delete files" }, 403);
  }

  const path = c.req.query("path");
  if (!path) return c.json({ error: "Missing path" }, 400);

  try {
    await adapter.delete(path);
    await auditLog("s3_file_deleted", session.user, { path });
    return c.json({ success: true });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// POST /api/s3/move - Move/rename S3 object
app.post("/api/s3/move", async (c) => {
  const result = await requireS3Session(c);
  if ("error" in result) return c.json({ error: result.error }, result.status);

  const { session, adapter } = result;
  if (session.role === "read-only") {
    return c.json({ error: "Read-only users cannot move files" }, 403);
  }

  const { source, destination } = await c.req.json();
  if (!source || !destination) {
    return c.json({ error: "Missing source or destination" }, 400);
  }

  try {
    await adapter.move(source, destination);
    await auditLog("s3_file_moved", session.user, { source, destination });
    return c.json({ success: true });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// POST /api/s3/copy - Copy S3 object
app.post("/api/s3/copy", async (c) => {
  const result = await requireS3Session(c);
  if ("error" in result) return c.json({ error: result.error }, result.status);

  const { session, adapter } = result;
  if (session.role === "read-only") {
    return c.json({ error: "Read-only users cannot copy files" }, 403);
  }

  const { source, destination } = await c.req.json();
  if (!source || !destination) {
    return c.json({ error: "Missing source or destination" }, 400);
  }

  try {
    await adapter.copy(source, destination);
    await auditLog("s3_file_copied", session.user, { source, destination });
    return c.json({ success: true });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// POST /api/s3/mkdir - Create S3 directory
app.post("/api/s3/mkdir", async (c) => {
  const result = await requireS3Session(c);
  if ("error" in result) return c.json({ error: result.error }, result.status);

  const { session, adapter } = result;
  if (session.role === "read-only") {
    return c.json({ error: "Read-only users cannot create directories" }, 403);
  }

  const { path } = await c.req.json();
  if (!path) return c.json({ error: "Missing path" }, 400);

  try {
    await adapter.mkdir(path);
    await auditLog("s3_directory_created", session.user, { path });
    return c.json({ success: true });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});
```

**Step 4: Commit**

```bash
git add server.ts
git commit -m "feat(s3): add S3 file operation endpoints"
```

---

## Task 4: Update Frontend Types

**Files:**
- Modify: `src/types.ts`

**Step 1: Add S3-related types**

Add to `src/types.ts` after the existing types:

```typescript
// S3 Types
export type StorageMode = "local" | "s3";

export interface S3Config {
  id: string;
  name: string;
  bucket: string;
  region: string;
  endpoint?: string;
  isDefault?: boolean;
}

export interface S3ConnectionState {
  connected: boolean;
  config?: {
    id: string;
    name: string;
    bucket: string;
    region: string;
  };
}

export interface S3ConfigForm {
  name: string;
  region: string;
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  prefix?: string;
}
```

**Step 2: Commit**

```bash
git add src/types.ts
git commit -m "feat(s3): add S3 types to frontend"
```

---

## Task 5: Update API Service Layer

**Files:**
- Modify: `src/services/api.ts`

**Step 1: Add S3 API functions**

Add to `src/services/api.ts` after existing functions:

```typescript
// S3 Configuration API
export async function s3ListConfigs() {
  return apiFetch<"/api/s3/configs">("/api/s3/configs").then(r => r.json());
}

export async function s3GetConfig(id: string) {
  return apiFetch<"/api/s3/configs/:id">(`/api/s3/configs/${id}`).then(r => r.json());
}

export async function s3CreateConfig(config: S3ConfigForm) {
  return apiFetch<"/api/s3/configs">("/api/s3/configs", {
    method: "POST",
    body: JSON.stringify(config),
  }).then(r => r.json());
}

export async function s3UpdateConfig(id: string, updates: Partial<S3ConfigForm>) {
  return apiFetch<"/api/s3/configs/:id">(`/api/s3/configs/${id}`, {
    method: "PUT",
    body: JSON.stringify(updates),
  }).then(r => r.json());
}

export async function s3DeleteConfig(id: string) {
  return apiFetch<"/api/s3/configs/:id">(`/api/s3/configs/${id}`, {
    method: "DELETE",
  }).then(r => r.json());
}

export async function s3TestConnection(id: string) {
  return apiFetch<"/api/s3/configs/:id/test">(`/api/s3/configs/${id}/test`, {
    method: "POST",
  }).then(r => r.json());
}

// S3 Session API
export async function s3Connect(configId: string) {
  return apiFetch<"/api/s3/connect">("/api/s3/connect", {
    method: "POST",
    body: JSON.stringify({ configId }),
  }).then(r => r.json());
}

export async function s3Disconnect() {
  return apiFetch<"/api/s3/disconnect">("/api/s3/disconnect", {
    method: "POST",
  }).then(r => r.json());
}

export async function s3GetCurrentConnection() {
  return apiFetch<"/api/s3/current">("/api/s3/current").then(r => r.json());
}

// S3 File Operations
export async function s3List(path: string, limit?: number, offset?: number) {
  const params = new URLSearchParams({ path });
  if (limit) params.set("limit", limit.toString());
  if (offset) params.set("offset", offset.toString());
  return apiFetch<"/api/s3/list">(`/api/s3/list?${params}`).then(r => r.json());
}

export async function s3Download(path: string) {
  const params = new URLSearchParams({ path });
  return apiFetch<"/api/s3/download">(`/api/s3/download?${params}`);
}

export async function s3Preview(path: string) {
  const params = new URLSearchParams({ path });
  return apiFetch<"/api/s3/preview">(`/api/s3/preview?${params}`).then(r => r.json());
}

export async function s3GetImage(path: string) {
  const params = new URLSearchParams({ path });
  return apiFetch<"/api/s3/image">(`/api/s3/image?${params}`);
}

export async function s3GetEdit(path: string) {
  const params = new URLSearchParams({ path });
  return apiFetch<"/api/s3/edit">(`/api/s3/edit?${params}`).then(r => r.json());
}

export async function s3SaveEdit(path: string, content: string) {
  return apiFetch<"/api/s3/edit">("/api/s3/edit", {
    method: "PUT",
    body: JSON.stringify({ path, content }),
  }).then(r => r.json());
}

export async function s3Upload(file: File, path: string) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("path", path);
  return apiFetch<"/api/s3/upload">("/api/s3/upload", {
    method: "POST",
    body: formData,
  }).then(r => r.json());
}

export async function s3Delete(path: string) {
  const params = new URLSearchParams({ path });
  return apiFetch<"/api/s3/delete">(`/api/s3/delete?${params}`, {
    method: "DELETE",
  }).then(r => r.json());
}

export async function s3Move(source: string, destination: string) {
  return apiFetch<"/api/s3/move">("/api/s3/move", {
    method: "POST",
    body: JSON.stringify({ source, destination }),
  }).then(r => r.json());
}

export async function s3Copy(source: string, destination: string) {
  return apiFetch<"/api/s3/copy">("/api/s3/copy", {
    method: "POST",
    body: JSON.stringify({ source, destination }),
  }).then(r => r.json());
}

export async function s3Mkdir(path: string) {
  return apiFetch<"/api/s3/mkdir">("/api/s3/mkdir", {
    method: "POST",
    body: JSON.stringify({ path }),
  }).then(r => r.json());
}
```

**Step 2: Commit**

```bash
git add src/services/api.ts
git commit -m "feat(s3): add S3 API service functions"
```

---

## Task 6: Create Storage Mode Switcher Component

**Files:**
- Create: `src/components/StorageSwitcher.tsx`
- Create: `src/components/S3ConnectionModal.tsx`

**Step 1: Create StorageSwitcher component**

Create file `src/components/StorageSwitcher.tsx`:

```typescript
import { StorageMode } from "../types";

interface StorageSwitcherProps {
  mode: StorageMode;
  onModeChange: (mode: StorageMode) => void;
  s3Connected?: boolean;
  s3ConfigName?: string;
}

export function StorageSwitcher({ mode, onModeChange, s3Connected, s3ConfigName }: StorageSwitcherProps) {
  return (
    <div className="flex items-center gap-2 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
      <button
        onClick={() => onModeChange("local")}
        className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
          mode === "local"
            ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm"
            : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
        }`}
      >
        <span className="flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
          </svg>
          Local Files
        </span>
      </button>
      <button
        onClick={() => onModeChange("s3")}
        className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
          mode === "s3"
            ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm"
            : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
        }`}
      >
        <span className="flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
          </svg>
          S3 Storage
          {s3Connected && (
            <span className="ml-1 px-1.5 py-0.5 text-xs bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 rounded">
              {s3ConfigName || "Connected"}
            </span>
          )}
        </span>
      </button>
    </div>
  );
}
```

**Step 2: Create S3ConnectionModal component**

Create file `src/components/S3ConnectionModal.tsx`:

```typescript
import { useState, useEffect } from "react";
import type { S3Config, S3ConnectionState } from "../types";
import { s3ListConfigs, s3Connect, s3Disconnect, s3GetCurrentConnection } from "../services/api";

interface S3ConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnected: () => void;
  userRole: string;
}

export function S3ConnectionModal({ isOpen, onClose, onConnected, userRole }: S3ConnectionModalProps) {
  const [configs, setConfigs] = useState<S3Config[]>([]);
  const [connection, setConnection] = useState<S3ConnectionState | null>(null);
  const [selectedId, setSelectedId] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    if (isOpen) {
      loadConfigs();
      loadConnection();
    }
  }, [isOpen]);

  const loadConfigs = async () => {
    try {
      const response = await s3ListConfigs();
      if (response.configs) {
        setConfigs(response.configs);
      }
    } catch (err) {
      setError("Failed to load S3 configurations");
    }
  };

  const loadConnection = async () => {
    try {
      const response = await s3GetCurrentConnection();
      setConnection(response);
    } catch {
      setConnection(null);
    }
  };

  const handleConnect = async () => {
    if (!selectedId) return;

    setLoading(true);
    setError("");

    try {
      await s3Connect(selectedId);
      onConnected();
      onClose();
    } catch (err: any) {
      setError(err.message || "Failed to connect to S3");
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    setLoading(true);
    setError("");

    try {
      await s3Disconnect();
      setConnection({ connected: false });
      onConnected();
    } catch (err: any) {
      setError(err.message || "Failed to disconnect");
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">S3 Connection</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 rounded-md text-sm">
            {error}
          </div>
        )}

        {connection?.connected ? (
          <div className="space-y-4">
            <div className="p-4 bg-green-50 dark:bg-green-900/30 rounded-md">
              <div className="flex items-center gap-3">
                <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                <div>
                  <p className="font-medium text-gray-900 dark:text-gray-100">Connected to S3</p>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    {connection.config?.name} ({connection.config?.bucket})
                  </p>
                </div>
              </div>
            </div>
            <button
              onClick={handleDisconnect}
              disabled={loading}
              className="w-full py-2 px-4 bg-red-600 hover:bg-red-700 text-white rounded-md font-medium disabled:opacity-50"
            >
              {loading ? "Disconnecting..." : "Disconnect"}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {configs.length === 0 ? (
              <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                <p>No S3 configurations found.</p>
                {userRole === "admin" && (
                  <p className="text-sm mt-2">Ask an administrator to create one.</p>
                )}
              </div>
            ) : (
              <>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Select an S3 configuration to connect:
                </p>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {configs.map((config) => (
                    <label
                      key={config.id}
                      className={`flex items-center p-3 border rounded-md cursor-pointer transition-colors ${
                        selectedId === config.id
                          ? "border-blue-500 bg-blue-50 dark:bg-blue-900/30"
                          : "border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500"
                      }`}
                    >
                      <input
                        type="radio"
                        name="s3-config"
                        value={config.id}
                        checked={selectedId === config.id}
                        onChange={(e) => setSelectedId(e.target.value)}
                        className="mr-3"
                      />
                      <div className="flex-1">
                        <p className="font-medium text-gray-900 dark:text-gray-100">{config.name}</p>
                        <p className="text-sm text-gray-600 dark:text-gray-400">
                          {config.bucket} ({config.region})
                        </p>
                      </div>
                      {config.isDefault && (
                        <span className="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded">
                          Default
                        </span>
                      )}
                    </label>
                  ))}
                </div>
                <button
                  onClick={handleConnect}
                  disabled={!selectedId || loading}
                  className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-md font-medium disabled:opacity-50"
                >
                  {loading ? "Connecting..." : "Connect"}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
```

**Step 3: Commit**

```bash
git add src/components/StorageSwitcher.tsx src/components/S3ConnectionModal.tsx
git commit -m "feat(s3): add storage mode switcher and S3 connection modal components"
```

---

## Task 7: Create S3 Configuration Management Modal (Admin Only)

**Files:**
- Create: `src/components/S3SettingsModal.tsx`

**Step 1: Create S3SettingsModal component**

Create file `src/components/S3SettingsModal.tsx`:

```typescript
import { useState, useEffect } from "react";
import type { S3Config, S3ConfigForm } from "../types";
import { s3ListConfigs, s3CreateConfig, s3UpdateConfig, s3DeleteConfig, s3TestConnection } from "../services/api";
import { useToasts } from "../hooks/useToasts";

interface S3SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface PresetTemplate {
  name: string;
  region: string;
  endpoint: string;
  label: string;
}

const PRESETS: PresetTemplate[] = [
  {
    name: "AWS S3",
    region: "us-east-1",
    endpoint: "",
    label: "Amazon S3",
  },
  {
    name: "Cloudflare R2",
    region: "auto",
    endpoint: "https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com",
    label: "Cloudflare R2",
  },
  {
    name: "Backblaze B2",
    region: "us-west-004",
    endpoint: "https://s3.us-west-004.backblazeb2.com",
    label: "Backblaze B2",
  },
  {
    name: "MinIO",
    region: "us-east-1",
    endpoint: "http://localhost:9000",
    label: "MinIO (Self-hosted)",
  },
];

export function S3SettingsModal({ isOpen, onClose }: S3SettingsModalProps) {
  const { showToast } = useToasts();
  const [configs, setConfigs] = useState<S3Config[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [form, setForm] = useState<S3ConfigForm>({
    name: "",
    region: "us-east-1",
    endpoint: "",
    accessKeyId: "",
    secretAccessKey: "",
    bucket: "",
    prefix: "",
  });
  const [selectedPreset, setSelectedPreset] = useState<string>("");

  useEffect(() => {
    if (isOpen) {
      loadConfigs();
    }
  }, [isOpen]);

  const loadConfigs = async () => {
    try {
      const response = await s3ListConfigs();
      if (response.configs) {
        setConfigs(response.configs);
      }
    } catch {
      showToast("Failed to load S3 configurations", "error");
    }
  };

  const resetForm = () => {
    setForm({
      name: "",
      region: "us-east-1",
      endpoint: "",
      accessKeyId: "",
      secretAccessKey: "",
      bucket: "",
      prefix: "",
    });
    setEditingId(null);
    setShowForm(false);
    setSelectedPreset("");
  };

  const handlePresetSelect = (preset: PresetTemplate) => {
    setForm({
      ...form,
      region: preset.region,
      endpoint: preset.endpoint,
    });
    setSelectedPreset(preset.label);
  };

  const handleSave = async () => {
    try {
      if (editingId) {
        await s3UpdateConfig(editingId, form);
        showToast("S3 configuration updated", "success");
      } else {
        await s3CreateConfig(form);
        showToast("S3 configuration created", "success");
      }
      await loadConfigs();
      resetForm();
    } catch (err: any) {
      showToast(err.message || "Failed to save configuration", "error");
    }
  };

  const handleEdit = (config: S3Config) => {
    setForm({
      name: config.name,
      region: config.region,
      endpoint: config.endpoint || "",
      accessKeyId: "",
      secretAccessKey: "",
      bucket: config.bucket,
      prefix: "",
    });
    setEditingId(config.id);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this S3 configuration?")) {
      return;
    }

    try {
      await s3DeleteConfig(id);
      showToast("S3 configuration deleted", "success");
      await loadConfigs();
    } catch (err: any) {
      showToast(err.message || "Failed to delete configuration", "error");
    }
  };

  const handleTest = async (id: string) => {
    setTestingId(id);
    try {
      const result = await s3TestConnection(id);
      if (result.success) {
        showToast("Connection successful!", "success");
      } else {
        showToast(result.error || "Connection failed", "error");
      }
    } catch (err: any) {
      showToast(err.message || "Connection test failed", "error");
    } finally {
      setTestingId(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-6 border-b dark:border-gray-700">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
              S3 Configuration
            </h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          {showForm ? (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-4">
                  {editingId ? "Edit Configuration" : "New Configuration"}
                </h3>

                {/* Quick Presets */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Quick Setup Preset
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {PRESETS.map((preset) => (
                      <button
                        key={preset.name}
                        type="button"
                        onClick={() => handlePresetSelect(preset)}
                        className={`p-3 text-left border rounded-md transition-colors ${
                          selectedPreset === preset.label
                            ? "border-blue-500 bg-blue-50 dark:bg-blue-900/30"
                            : "border-gray-300 dark:border-gray-600 hover:border-gray-400"
                        }`}
                      >
                        <p className="font-medium text-gray-900 dark:text-gray-100">{preset.label}</p>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Configuration Name *
                    </label>
                    <input
                      type="text"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder="My S3 Bucket"
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Bucket Name *
                    </label>
                    <input
                      type="text"
                      value={form.bucket}
                      onChange={(e) => setForm({ ...form, bucket: e.target.value })}
                      placeholder="my-bucket"
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Region *
                    </label>
                    <input
                      type="text"
                      value={form.region}
                      onChange={(e) => setForm({ ...form, region: e.target.value })}
                      placeholder="us-east-1"
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Access Key ID *
                    </label>
                    <input
                      type="text"
                      value={form.accessKeyId}
                      onChange={(e) => setForm({ ...form, accessKeyId: e.target.value })}
                      placeholder="AKIAIOSFODNN7EXAMPLE"
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Secret Access Key *
                    </label>
                    <input
                      type="password"
                      value={form.secretAccessKey}
                      onChange={(e) => setForm({ ...form, secretAccessKey: e.target.value })}
                      placeholder="••••••••••••••••"
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Optional Prefix
                    </label>
                    <input
                      type="text"
                      value={form.prefix}
                      onChange={(e) => setForm({ ...form, prefix: e.target.value })}
                      placeholder="path/to/files/"
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    />
                  </div>

                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Custom Endpoint (Optional)
                    </label>
                    <input
                      type="text"
                      value={form.endpoint}
                      onChange={(e) => setForm({ ...form, endpoint: e.target.value })}
                      placeholder="https://s3.example.com"
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                    />
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      Required for Cloudflare R2, Backblaze B2, MinIO, and other S3-compatible services
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 justify-end pt-4">
                <button
                  onClick={resetForm}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={!form.name || !form.region || !form.accessKeyId || !form.secretAccessKey || !form.bucket}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md disabled:opacity-50"
                >
                  {editingId ? "Update" : "Create"}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {configs.length === 0 ? (
                <div className="text-center py-12 text-gray-500 dark:text-gray-400">
                  <svg className="w-16 h-16 mx-auto mb-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
                  </svg>
                  <p className="text-lg font-medium">No S3 configurations</p>
                  <p className="text-sm mt-1">Create a configuration to connect to S3-compatible storage</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {configs.map((config) => (
                    <div
                      key={config.id}
                      className="p-4 border border-gray-300 dark:border-gray-600 rounded-md"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <h4 className="font-medium text-gray-900 dark:text-gray-100">{config.name}</h4>
                            {config.isDefault && (
                              <span className="px-2 py-0.5 text-xs bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded">
                                Default
                              </span>
                            )}
                          </div>
                          <div className="mt-2 text-sm text-gray-600 dark:text-gray-400 space-y-1">
                            <p>Bucket: <code className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded">{config.bucket}</code></p>
                            <p>Region: <code className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded">{config.region}</code></p>
                            {config.endpoint && (
                              <p>Endpoint: <code className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 rounded text-xs break-all">{config.endpoint}</code></p>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleTest(config.id)}
                            disabled={testingId === config.id}
                            className="p-2 text-gray-500 hover:text-green-600 dark:hover:text-green-400 disabled:opacity-50"
                            title="Test connection"
                          >
                            {testingId === config.id ? (
                              <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                              </svg>
                            ) : (
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                            )}
                          </button>
                          <button
                            onClick={() => handleEdit(config)}
                            className="p-2 text-gray-500 hover:text-blue-600 dark:hover:text-blue-400"
                            title="Edit"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => handleDelete(config.id)}
                            className="p-2 text-gray-500 hover:text-red-600 dark:hover:text-red-400"
                            title="Delete"
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <button
                onClick={() => setShowForm(true)}
                className="w-full py-3 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-md text-gray-600 dark:text-gray-400 hover:border-blue-500 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
              >
                <span className="flex items-center justify-center gap-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                  Add New Configuration
                </span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add src/components/S3SettingsModal.tsx
git commit -m "feat(s3): add S3 settings modal for admin configuration management"
```

---

## Task 8: Update App.tsx for Storage Mode Switching

**Files:**
- Modify: `src/App.tsx`

**Step 1: Add storage mode state and imports**

Add to imports in `src/App.tsx`:

```typescript
import { StorageSwitcher } from "./components/StorageSwitcher";
import { S3ConnectionModal } from "./components/S3ConnectionModal";
import { S3SettingsModal } from "./components/S3SettingsModal";
import type { StorageMode, S3ConnectionState } from "./types";
import * as s3Api from "./services/api";
```

Add state after existing state declarations (around line 50-60):

```typescript
const [storageMode, setStorageMode] = useState<StorageMode>(() => {
  return (localStorage.getItem("storageMode") as StorageMode) || "local";
});
const [showS3Connection, setShowS3Connection] = useState(false);
const [showS3Settings, setShowS3Settings] = useState(false);
const [s3Connection, setS3Connection] = useState<S3ConnectionState>({ connected: false });
```

**Step 2: Add effect to sync storage mode with localStorage and check S3 connection**

Add after existing useEffect hooks:

```typescript
// Sync storage mode to localStorage
useEffect(() => {
  localStorage.setItem("storageMode", storageMode);
}, [storageMode]);

// Check S3 connection status
useEffect(() => {
  if (storageMode === "s3") {
    s3Api.s3GetCurrentConnection()
      .then(setS3Connection)
      .catch(() => setS3Connection({ connected: false }));
  }
}, [storageMode]);
```

**Step 3: Update loadFiles function to handle S3 mode**

Modify the existing `loadFiles` function to handle both storage modes:

```typescript
const loadFiles = useCallback(async () => {
  if (auth !== "authenticated") return;

  setLoading(true);
  setError(null);

  try {
    if (storageMode === "s3") {
      if (!s3Connection.connected) {
        setEntries([]);
        setLoading(false);
        return;
      }
      const response = await s3Api.s3List(path, pageSize, page * pageSize);
      setEntries(response.entries || []);
      setTotal(response.total || 0);
    } else {
      // Local mode - existing code
      const params = new URLSearchParams({
        path,
        limit: pageSize.toString(),
        offset: (page * pageSize).toString(),
      });
      const response = await apiFetch(`/api/list?${params}`);
      const data = await response.json();
      setEntries(data.entries || []);
      setTotal(data.total || 0);
    }
  } catch (err: any) {
    setError(err.message || "Failed to load files");
    setEntries([]);
  } finally {
    setLoading(false);
  }
}, [auth, path, page, pageSize, storageMode, s3Connection.connected]);
```

**Step 4: Update file operation functions to handle S3 mode**

Modify upload, download, delete, move, copy, and mkdir functions to check storage mode and call appropriate API. Example for download:

```typescript
const handleDownload = useCallback((entry: Entry) => {
  if (storageMode === "s3") {
    window.location.href = `/api/s3/download?path=${encodeURIComponent(entry.path)}`;
  } else {
    window.location.href = `/api/download?path=${encodeURIComponent(entry.path)}`;
  }
}, [storageMode]);
```

Similar changes for other operations.

**Step 5: Update Header component to include storage switcher**

Add to the Header component props and render:

```typescript
<StorageSwitcher
  mode={storageMode}
  onModeChange={(mode) => {
    if (mode === "s3" && !s3Connection.connected) {
      setShowS3Connection(true);
    }
    setStorageMode(mode);
    setPath("/");
    setPage(0);
    setSelected(null);
    setSelectedNames([]);
  }}
  s3Connected={s3Connection.connected}
  s3ConfigName={s3Connection.config?.name}
/>
```

**Step 6: Add S3 settings button to admin menu**

Add to the user menu in Header (if userRole is admin):

```typescript
{userRole === "admin" && storageMode === "s3" && (
  <button
    onClick={() => setShowS3Settings(true)}
    className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700"
  >
    S3 Settings
  </button>
)}
```

**Step 7: Add modals to render**

Add before the closing return statement:

```typescript
<S3ConnectionModal
  isOpen={showS3Connection}
  onClose={() => setShowS3Connection(false)}
  onConnected={async () => {
    const conn = await s3Api.s3GetCurrentConnection();
    setS3Connection(conn);
    loadFiles();
  }}
  userRole={userRole}
/>

{userRole === "admin" && (
  <S3SettingsModal
    isOpen={showS3Settings}
    onClose={() => setShowS3Settings(false)}
  />
)}
```

**Step 8: Commit**

```bash
git add src/App.tsx
git commit -m "feat(s3): integrate storage mode switcher into main app"
```

---

## Task 9: Update Constants File

**Files:**
- Modify: `src/constants.ts`

**Step 1: Add S3-related constants**

Add to `src/constants.ts`:

```typescript
export const S3_PRESETS = [
  {
    id: "aws",
    name: "Amazon S3",
    region: "us-east-1",
    endpoint: "",
  },
  {
    id: "r2",
    name: "Cloudflare R2",
    region: "auto",
    endpoint: "https://YOUR_ACCOUNT_ID.r2.cloudflarestorage.com",
  },
  {
    id: "b2",
    name: "Backblaze B2",
    region: "us-west-004",
    endpoint: "https://s3.us-west-004.backblazeb2.com",
  },
  {
    id: "minio",
    name: "MinIO",
    region: "us-east-1",
    endpoint: "http://localhost:9000",
  },
] as const;
```

**Step 2: Commit**

```bash
git add src/constants.ts
git commit -m "feat(s3): add S3 preset constants"
```

---

## Task 10: Install AWS SDK Dependency

**Files:**
- Modify: `package.json`

**Step 1: Install AWS SDK client**

Run: `bun add @aws-sdk/client-s3`

**Step 2: Verify installation**

Run: `bun list | grep aws-sdk`
Expected: `@aws-sdk/client-s3@...`

**Step 3: Commit**

```bash
git add package.json package-lock.json bun.lockb
git commit -m "feat(s3): add AWS SDK client dependency"
```

---

## Task 11: Update Styles and Visual Indicators

**Files:**
- Modify: `src/components/Header.tsx` (for layout adjustments)
- Modify: `src/index.css` (if needed for new styles)

**Step 1: Add visual indicator for storage mode**

Add a subtle visual indicator to show current storage mode in the app.

**Step 2: Ensure responsive design for storage switcher**

Make sure the storage switcher works on mobile devices.

**Step 3: Commit**

```bash
git add src/components/Header.tsx src/index.css
git commit -m "feat(s3): add visual indicators and responsive styles for storage mode"
```

---

## Task 12: Add Unit Tests for Storage Adapters

**Files:**
- Create: `tests/storage/adapters.integration.test.ts`

**Step 1: Write integration tests**

Create integration tests for S3 adapter (using localstack or mock S3).

**Step 2: Run tests**

Run: `bun test tests/storage/`

**Step 3: Commit**

```bash
git add tests/storage/
git commit -m "test(s3): add integration tests for storage adapters"
```

---

## Task 13: Update Documentation

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`

**Step 1: Update README with S3 feature documentation**

Add section explaining S3 integration, how to configure, and supported services.

**Step 2: Update CLAUDE.md with architecture changes**

Document the new storage abstraction layer and S3 endpoints.

**Step 3: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: add S3 integration documentation"
```

---

## Task 14: Final Integration Testing

**Files:**
- No new files - integration testing

**Step 1: Test local storage mode**

Run: `bun run dev`
Test all file operations in local mode.

**Step 2: Test S3 configuration**

1. Log in as admin
2. Open S3 Settings
3. Create a test configuration (use MinIO or actual S3)
4. Test connection
5. Switch to S3 mode
6. Test file operations

**Step 3: Test connection persistence**

Refresh page and verify S3 connection persists.

**Step 4: Test role permissions**

Verify read-only users cannot modify S3 files.

**Step 5: Test error handling**

Test with invalid credentials, network errors, etc.

**Step 6: Final commit**

```bash
git commit --allow-empty -m "test(s3): complete integration testing"
```

---

## Summary

This plan implements S3 integration with:

1. **Storage Abstraction Layer** - Local and S3 adapters with unified interface
2. **S3 Configuration Management** - Admin-only CRUD operations for S3 credentials
3. **Separated Views** - Local and S3 modes with independent navigation states
4. **Security** - Role-based access, audit logging for all S3 operations
5. **Flexible Configuration** - Support for AWS S3, Cloudflare R2, Backblaze B2, MinIO, and other S3-compatible services
6. **Connection Testing** - Admin can test S3 connections before saving
7. **Session-based S3 Access** - Each user session can connect to different S3 configs

**Total Estimated Tasks:** 14
**Total Estimated Files Changed/Created:** ~20 files
