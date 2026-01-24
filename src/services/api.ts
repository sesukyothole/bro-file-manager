import { API_BASE } from "../constants";
import type { S3ConfigForm } from "../types";

export async function apiFetch(path: string, init?: RequestInit) {
  return fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: "include",
  });
}

export async function readJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

// ============================================================================
// S3 Configuration API
// ============================================================================

export async function s3ListConfigs() {
  return apiFetch("/api/s3/configs").then(r => r.json());
}

export async function s3GetConfig(id: string) {
  return apiFetch(`/api/s3/configs/${id}`).then(r => r.json());
}

export async function s3CreateConfig(config: S3ConfigForm) {
  return apiFetch("/api/s3/configs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  }).then(r => r.json());
}

export async function s3UpdateConfig(id: string, updates: Partial<S3ConfigForm>) {
  return apiFetch(`/api/s3/configs/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  }).then(r => r.json());
}

export async function s3DeleteConfig(id: string) {
  return apiFetch(`/api/s3/configs/${id}`, {
    method: "DELETE",
  }).then(r => r.json());
}

export async function s3TestConnection(id: string) {
  return apiFetch(`/api/s3/configs/${id}/test`, {
    method: "POST",
  }).then(r => r.json());
}

// ============================================================================
// S3 Session API
// ============================================================================

export async function s3Connect(configId: string) {
  return apiFetch("/api/s3/connect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ configId }),
  }).then(r => r.json());
}

export async function s3Disconnect() {
  return apiFetch("/api/s3/disconnect", {
    method: "POST",
  }).then(r => r.json());
}

export async function s3GetCurrentConnection() {
  return apiFetch("/api/s3/current").then(r => r.json());
}

// ============================================================================
// S3 File Operations
// ============================================================================

export async function s3List(path: string, limit?: number, offset?: number) {
  const params = new URLSearchParams({ path });
  if (limit) params.set("limit", limit.toString());
  if (offset) params.set("offset", offset.toString());
  return apiFetch(`/api/s3/list?${params}`).then(r => r.json());
}

export async function s3Download(path: string) {
  const params = new URLSearchParams({ path });
  return apiFetch(`/api/s3/download?${params}`);
}

export async function s3Preview(path: string) {
  const params = new URLSearchParams({ path });
  return apiFetch(`/api/s3/preview?${params}`).then(r => r.json());
}

export async function s3GetImage(path: string) {
  const params = new URLSearchParams({ path });
  return apiFetch(`/api/s3/image?${params}`);
}

export async function s3GetEdit(path: string) {
  const params = new URLSearchParams({ path });
  return apiFetch(`/api/s3/edit?${params}`).then(r => r.json());
}

export async function s3SaveEdit(path: string, content: string) {
  return apiFetch("/api/s3/edit", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, content }),
  }).then(r => r.json());
}

export async function s3Upload(file: File, path: string) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("path", path);
  return apiFetch("/api/s3/upload", {
    method: "POST",
    body: formData,
  }).then(r => r.json());
}

export async function s3Delete(path: string) {
  const params = new URLSearchParams({ path });
  return apiFetch(`/api/s3/delete?${params}`, {
    method: "DELETE",
  }).then(r => r.json());
}

export async function s3Move(source: string, destination: string) {
  return apiFetch("/api/s3/move", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source, destination }),
  }).then(r => r.json());
}

export async function s3Copy(source: string, destination: string) {
  return apiFetch("/api/s3/copy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source, destination }),
  }).then(r => r.json());
}

export async function s3Mkdir(path: string) {
  return apiFetch("/api/s3/mkdir", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  }).then(r => r.json());
}
