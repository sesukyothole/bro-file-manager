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
