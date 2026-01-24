import { genId, sanitizeHeaders } from "./utils.js";

export const DEFAULT_SYSTEM_PROMPT =
  "You are an AI assistant inside a local notebook app. Return concise answers in Markdown.";

export const DEFAULT_LLM_SETTINGS = {
  providers: [],
  cachedModels: [],
  cacheTimestamp: 0
};

export const LLM_SETTINGS_KEY = "ainotebook-llm-settings-v1";

export class LlmManager {
  /**
   * Manages LLM providers, models, settings, and API calls.
   * Handles caching of models and execution of completion requests.
   */
  constructor() {
    this.settings = this.loadSettings();
    this.refreshModelsInFlight = false;
    this.modelCacheStatus = null; // Element to update status
  }

  /**
   * Loads settings from localStorage.
   * Migrates legacy formats and normalizes data structure.
   * @returns {Object} The settings object.
   */
  loadSettings() {
    try {
      const raw = localStorage.getItem(LLM_SETTINGS_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      const providers = Array.isArray(parsed.providers)
        ? parsed.providers
        : [];
      const cachedModels = Array.isArray(parsed.cachedModels)
        ? parsed.cachedModels
        : [];
      const cacheTimestamp =
        typeof parsed.cacheTimestamp === "number" ? parsed.cacheTimestamp : 0;
      const env = typeof parsed.env === "object" ? parsed.env : {};
      const normalizedCachedModels = cachedModels
        .filter(m => m && typeof m === 'object')
        .map((m) => {
          const providersList = Array.isArray(providers) ? providers : [];
          const provider =
            providersList.find((p) => p.id === m.providerId) ||
            providersList.find((p) => p.provider === m.provider);
          const providerName = provider?.provider || m.provider || "openai";
          return {
            ...m,
            provider: providerName,
            providerId: m.providerId || provider?.id,
            apiKey: m.apiKey || provider?.apiKey || "",
            baseUrl:
              m.baseUrl ||
              provider?.baseUrl ||
              this.getProviderDefaultBaseUrl(providerName)
          };
        });

      // Legacy migration
      if (!providers.length && Array.isArray(parsed.models)) {
        const map = new Map();
        parsed.models.forEach((m) => {
          if (!m) return;
          const key = `${m.provider || "openai"}|${m.baseUrl || ""}`;
          if (!map.has(key)) {
            map.set(key, {
              id: genId("provider"),
              provider: m.provider || "openai",
              baseUrl: m.baseUrl || "",
              apiKey: m.apiKey || ""
            });
          }
        });
        map.forEach((val) => providers.push(val));
      }

      return {
        ...DEFAULT_LLM_SETTINGS,
        providers,
        cachedModels: normalizedCachedModels,
        cacheTimestamp,
        env: env || {}
      };
    } catch (err) {
      console.error("Error loading settings:", err);
      return { ...DEFAULT_LLM_SETTINGS };
    }
  }

  /**
   * Saves current settings to localStorage.
   */
  saveSettings() {
    try {
      localStorage.setItem(LLM_SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      // ignore
    }
  }

  /**
   * Gets the default base URL for a given provider.
   * @param {string} provider - The provider ID (openai, claude, openrouter).
   * @returns {string} The default API base URL.
   */
  getProviderDefaultBaseUrl(provider) {
    if (provider === "claude") return "https://api.anthropic.com/v1";
    if (provider === "openrouter") return "https://openrouter.ai/api/v1";
    if (provider === "custom") return "";
    return "https://api.openai.com/v1";
  }

  /**
   * Gets the display label for a provider.
   * @param {string} provider - The provider ID.
   * @returns {string} Display label.
   */
  getProviderLabel(provider) {
    if (provider === "claude") return "Anthropic";
    if (provider === "openrouter") return "OpenRouter";
    if (provider === "custom") return "Custom";
    return "OpenAI";
  }

  /**
   * Formats a model object for display in dropdowns.
   * @param {Object} model - The model object.
   * @returns {string} Formatted string "Provider/ModelName".
   */
  formatModelDisplay(model) {
    if (!model) return "";
    const providerName = this.getProviderLabel(model.provider);
    const modelName = model.displayName || model.model || model.id || "";
    return `${providerName}/${modelName}`;
  }

  /**
   * Creates a standard model ID in the format "Provider/model-name".
   * This format is portable across different provider configurations.
   * @param {string} provider - The provider type (openai, claude, openrouter, custom).
   * @param {string} modelName - The model name/id.
   * @returns {string} Standard model ID.
   */
  createStandardModelId(provider, modelName) {
    const providerLabel = this.getProviderLabel(provider);
    return `${providerLabel}/${modelName}`;
  }

  /**
   * Parses a standard model ID into its components.
   * Handles both new format (Provider/model) and legacy format (provider_id:model).
   * @param {string} id - The model ID to parse.
   * @returns {Object|null} { provider, model } or null if invalid.
   */
  parseModelId(id) {
    if (!id || typeof id !== "string") return null;

    // New standard format: Provider/model-name (e.g., "OpenAI/gpt-4", "OpenRouter/openai/gpt-4")
    if (id.includes("/")) {
      const slashIndex = id.indexOf("/");
      const providerLabel = id.slice(0, slashIndex);
      const modelName = id.slice(slashIndex + 1);
      // Convert display label back to provider type
      const provider = this.getProviderFromLabel(providerLabel);
      return { provider, providerLabel, model: modelName };
    }

    // Legacy format: provider_id:model-name (e.g., "provider_abc123:gpt-4")
    if (id.includes(":")) {
      const colonIndex = id.indexOf(":");
      const providerId = id.slice(0, colonIndex);
      const modelName = id.slice(colonIndex + 1);
      // Try to find the provider by its ID
      const providerObj = (this.settings.providers || []).find(p => p.id === providerId);
      if (providerObj) {
        return { provider: providerObj.provider, providerLabel: this.getProviderLabel(providerObj.provider), model: modelName, legacyProviderId: providerId };
      }
      // If provider not found, return with unknown provider
      return { provider: "openai", providerLabel: "OpenAI", model: modelName, legacyProviderId: providerId };
    }

    return null;
  }

  /**
   * Converts a provider display label back to the internal provider type.
   * @param {string} label - Display label (OpenAI, Anthropic, OpenRouter, Custom).
   * @returns {string} Provider type.
   */
  getProviderFromLabel(label) {
    const lower = (label || "").toLowerCase();
    if (lower === "anthropic" || lower === "claude") return "claude";
    if (lower === "openrouter") return "openrouter";
    if (lower === "custom") return "custom";
    return "openai";
  }

  /**
   * Extracts the base model name from a potentially provider-prefixed model string.
   * E.g., "openai/gpt-4" -> "gpt-4", "gpt-4" -> "gpt-4"
   * @param {string} modelName - The model name which may include provider prefix.
   * @returns {string} The base model name.
   */
  extractBaseModelName(modelName) {
    if (!modelName) return "";
    // OpenRouter models often have format like "openai/gpt-4" or "anthropic/claude-3"
    // Extract the last segment as the base model
    const parts = modelName.split("/");
    return parts[parts.length - 1];
  }

  /**
   * Retrieves a cached model by its unique ID.
   * Handles both standard format (Provider/model) and legacy format (provider_id:model).
   * If exact match not found, attempts to find the model through alternative providers
   * ONLY when the original provider is not configured.
   * @param {string} id - The model ID.
   * @returns {Object|null} The model object or null.
   */
  getModelById(id) {
    if (!id) return null;
    const models = this.settings.cachedModels || [];

    // Direct match by ID
    const direct = models.find((m) => m.id === id);
    if (direct) return direct;

    // Parse the ID to understand what we're looking for
    const parsed = this.parseModelId(id);
    if (!parsed) return null;

    // For legacy format, try to find by provider ID and model
    if (parsed.legacyProviderId) {
      const byLegacy = models.find(m => 
        m.providerId === parsed.legacyProviderId && m.model === parsed.model
      );
      if (byLegacy) return byLegacy;
    }

    // Try to find the model from the same provider type with exact model name
    const sameProvider = models.find(m => 
      m.provider === parsed.provider && m.model === parsed.model
    );
    if (sameProvider) return sameProvider;

    // Check if the original provider type has ANY models configured
    // Only fall back to alternative providers if the original provider is not available
    const providerHasModels = models.some(m => m.provider === parsed.provider);
    if (providerHasModels) {
      // Original provider is configured but doesn't have this specific model
      // Don't fall back - the model simply doesn't exist
      return null;
    }

    // Fallback: original provider is NOT configured, try to find the base model
    // from any other provider. E.g., OpenRouter/openai/gpt-4 -> OpenAI/gpt-4
    const baseModel = this.extractBaseModelName(parsed.model);
    const anyProvider = models.find(m => {
      const mBase = this.extractBaseModelName(m.model);
      return mBase === baseModel;
    });
    if (anyProvider) return anyProvider;

    return null;
  }

  /**
   * Converts a legacy model ID to the new standard format.
   * @param {string} id - The model ID (may be legacy or standard).
   * @returns {string} The standard format ID, or original if conversion not possible.
   */
  convertToStandardId(id) {
    if (!id) return id;
    
    // Already in standard format
    if (id.includes("/") && !id.includes(":")) {
      return id;
    }

    // Legacy format - convert
    const parsed = this.parseModelId(id);
    if (parsed) {
      return this.createStandardModelId(parsed.provider, parsed.model);
    }

    return id;
  }

  /**
   * Resolves a model ID to a working model, with fallback to alternative providers.
   * Returns both the resolved model and the canonical ID that should be stored.
   * @param {string} id - The model ID to resolve.
   * @returns {{ model: Object|null, canonicalId: string }} Resolved model and canonical ID.
   */
  resolveModelId(id) {
    if (!id) return { model: null, canonicalId: "" };

    const model = this.getModelById(id);
    if (model) {
      // Return the model with its canonical (standard) ID
      const canonicalId = this.createStandardModelId(model.provider, model.model);
      return { model, canonicalId };
    }

    return { model: null, canonicalId: id };
  }

  /**
   * Gets the display label for a model ID.
   * @param {string} id - The model ID.
   * @returns {string} The formatted label.
   */
  getModelLabelById(id) {
    if (!id) return "";
    const m = this.getModelById(id);
    if (!m) return "";
    return this.formatModelDisplay(m);
  }

  /**
   * Hydrates a model object with its provider's current configuration (API key, base URL).
   * @param {string} id - The model ID.
   * @returns {Object|null} The hydrated model object or null.
   */
  getModelWithProvider(id) {
    const model = this.getModelById(id);
    if (!model) return null;
    const providers = Array.isArray(this.settings.providers)
      ? this.settings.providers
      : [];
    const provider =
      providers.find((p) => p.id === model.providerId) ||
      providers.find((p) => p.provider === model.provider);
    const providerBase =
      provider?.baseUrl ||
      this.getProviderDefaultBaseUrl(provider?.provider || model.provider);
    return {
      ...model,
      provider: provider?.provider || model.provider,
      apiKey: model.apiKey || provider?.apiKey || "",
      baseUrl: model.baseUrl || providerBase
    };
  }

  /**
   * Filters cached models based on a search term.
   * @param {string} searchTerm - The search string.
   * @returns {Array} Filtered list of models.
   */
  getFilteredModels(searchTerm = "") {
    const term = (searchTerm || "").trim().toLowerCase();
    const models = Array.isArray(this.settings.cachedModels)
      ? this.settings.cachedModels
      : [];
    if (!term) return models;
    return models.filter((m) => {
      const name = this.formatModelDisplay(m).toLowerCase();
      const raw = `${m.model || ""}`.toLowerCase();
      return name.includes(term) || raw.includes(term);
    });
  }

  setModelCacheStatusElement(el) {
    this.modelCacheStatus = el;
  }

  updateModelCacheStatus(text, type = "info") {
    if (!this.modelCacheStatus) return;
    this.modelCacheStatus.textContent = text;
    this.modelCacheStatus.dataset.type = type;
  }

  /**
   * Refreshes the list of available models from all configured providers.
   * Updates the cache and status UI.
   * @param {Array} providersFromDialog - Optional updated provider list from settings dialog.
   */
  async refreshModelCache(providersFromDialog = null) {
    if (providersFromDialog) {
      this.settings.providers = providersFromDialog;
      this.saveSettings();
    }

    if (this.refreshModelsInFlight) return;
    const providers = this.settings.providers || [];
    if (!providers.length) {
      this.updateModelCacheStatus("Add a provider to fetch models.", "warn");
      return;
    }

    this.refreshModelsInFlight = true;
    this.updateModelCacheStatus("Refreshing model list…", "info");
    const collected = [];
    let errors = 0;

    for (const provider of providers) {
      try {
        const models = await this.fetchModelsForProvider(provider);
        models.forEach((m) =>
          collected.push({
            ...m,
            // Use standard format: Provider/model-name
            id: this.createStandardModelId(provider.provider, m.model),
            providerId: provider.id,
            provider: provider.provider,
            apiKey: provider.apiKey,
            baseUrl:
              provider.baseUrl ||
              this.getProviderDefaultBaseUrl(provider.provider)
          })
        );
      } catch (err) {
        console.error("Model fetch failed", provider, err);
        errors += 1;
      }
    }

    this.settings.cachedModels = collected;
    this.settings.cacheTimestamp = Date.now();
    this.saveSettings();

    if (errors && collected.length) {
      this.updateModelCacheStatus(
        `Fetched ${collected.length} models with ${errors} error(s).`,
        "warn"
      );
    } else if (errors && !collected.length) {
      this.updateModelCacheStatus(
        "Could not refresh models. Check provider settings.",
        "error"
      );
    } else {
      this.updateModelCacheStatus(
        `Fetched ${collected.length} models just now.`,
        "success"
      );
    }

    this.refreshModelsInFlight = false;
  }

  /**
   * Fetches models for a single provider.
   * @param {Object} provider - The provider configuration object.
   * @returns {Promise<Array>} List of models.
   */
  async fetchModelsForProvider(provider) {
    const baseUrl = (
      provider.baseUrl || this.getProviderDefaultBaseUrl(provider.provider)
    ).replace(/\/+$/, "");
    const headers = {
      "Content-Type": "application/json"
    };
    if (!provider.apiKey) {
      throw new Error("Missing API key");
    }

    if (provider.provider === "claude") {
      headers["x-api-key"] = provider.apiKey;
      headers["anthropic-version"] = "2023-06-01";
      headers["anthropic-dangerous-direct-browser-access"] = "true";
      const res = await fetch(`${baseUrl}/models`, { headers, method: "GET" });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Claude models error ${res.status}: ${text}`);
      }
      const json = await res.json();
      const data = Array.isArray(json.data)
        ? json.data
        : Array.isArray(json.models)
        ? json.models
        : [];
      return data
        .map((m) => ({
          model: m?.id || m?.name,
          displayName: m?.display_name || m?.id || m?.name,
          createdAt: m?.created_at
        }))
        .filter((m) => !!m.model);
    }

    if (provider.provider === "openrouter") {
      headers["Authorization"] = `Bearer ${provider.apiKey}`;
      const res = await fetch(`${baseUrl}/models`, { headers, method: "GET" });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`OpenRouter models error ${res.status}: ${text}`);
      }
      const json = await res.json();
      const data = Array.isArray(json.data) ? json.data : json.models || [];
      return data
        .map((m) => m?.id || m?.model)
        .filter(Boolean)
        .map((id) => ({ model: id }));
    }

    // default openai
    headers["Authorization"] = `Bearer ${provider.apiKey}`;
    const res = await fetch(`${baseUrl}/models`, { headers, method: "GET" });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`OpenAI models error ${res.status}: ${text}`);
    }
    const json = await res.json();
    const data = Array.isArray(json.data) ? json.data : [];
    return data
      .map((m) => m?.id)
      .filter(Boolean)
      .map((id) => ({ model: id }));
  }

  /**
   * Routes an LLM call to the appropriate provider implementation.
   * @param {Object} model - The model configuration.
   * @param {string} prompt - The user prompt.
   * @param {string} systemPrompt - The system prompt.
   * @param {AbortSignal} signal - Abort signal for cancellation.
   * @param {Object} params - Additional parameters (temperature, etc.).
   * @returns {Promise<Object>} The LLM response.
   */
  async callLLM(model, prompt, systemPrompt, signal, params = {}) {
    if (model.provider === "claude") {
      return this.callClaude(model, prompt, systemPrompt, signal, params);
    }
    if (model.provider === "openrouter") {
      return this.callOpenRouter(model, prompt, systemPrompt, signal, params);
    }
    // default to openai
    return this.callOpenAI(model, prompt, systemPrompt, signal, params);
  }

  async callOpenAI(model, prompt, systemPrompt, signal, params) {
    const baseUrl = (model.baseUrl || "https://api.openai.com/v1").replace(
      /\/+$/,
      ""
    );
    const url = `${baseUrl}/chat/completions`;

    const requestBody = {
      model: model.model,
      ...params,
      messages: [
        {
          role: "system",
          content: systemPrompt || DEFAULT_SYSTEM_PROMPT
        },
        { role: "user", content: prompt }
      ]
    };
    const requestHeaders = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${model.apiKey}`
    };

    const res = await fetch(url, {
      method: "POST",
      signal,
      headers: requestHeaders,
      body: JSON.stringify(requestBody)
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`OpenAI error ${res.status}: ${text}`);
    }

    const json = await res.json();
    const content =
      json.choices?.[0]?.message?.content ||
      json.choices?.[0]?.text ||
      "";
    const resHeaders = {};
    res.headers.forEach((v, k) => {
      resHeaders[k] = v;
    });
    return {
      text: String(content).trim(),
      usage: json.usage || {},
      _rawRequest: {
        url,
        method: "POST",
        headers: sanitizeHeaders(requestHeaders),
        body: requestBody
      },
      _rawResponse: {
        status: res.status,
        headers: resHeaders,
        body: json
      }
    };
  }

  async callClaude(model, prompt, systemPrompt, signal, params) {
    const baseUrl = (model.baseUrl || "https://api.anthropic.com/v1").replace(
      /\/+$/,
      ""
    );
    const url = `${baseUrl}/messages`;

    const requestBody = {
      model: model.model,
      max_tokens: 1024,
      ...params,
      system: systemPrompt || DEFAULT_SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }]
    };
    const requestHeaders = {
      "Content-Type": "application/json",
      "x-api-key": model.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    };

    const res = await fetch(url, {
      method: "POST",
      signal,
      headers: requestHeaders,
      body: JSON.stringify(requestBody)
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Claude error ${res.status}: ${text}`);
    }

    const json = await res.json();
    const contentArray = json.content || [];
    const firstText = contentArray.find((c) => c.type === "text");
    const content = firstText?.text || "";
    const resHeaders = {};
    res.headers.forEach((v, k) => (resHeaders[k] = v));
    return {
      text: String(content).trim(),
      usage: json.usage || {},
      _rawRequest: {
        url,
        method: "POST",
        headers: sanitizeHeaders(requestHeaders),
        body: requestBody
      },
      _rawResponse: {
        status: res.status,
        headers: resHeaders,
        body: json
      }
    };
  }

  async callOpenRouter(model, prompt, systemPrompt, signal, params) {
    const baseUrl = (model.baseUrl || "https://openrouter.ai/api/v1").replace(
      /\/+$/,
      ""
    );
    const url = `${baseUrl}/chat/completions`;

    const requestHeaders = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${model.apiKey}`
    };
    const requestBody = {
      model: model.model,
      ...params,
      messages: [
        {
          role: "system",
          content: systemPrompt || DEFAULT_SYSTEM_PROMPT
        },
        { role: "user", content: prompt }
      ]
    };

    const res = await fetch(url, {
      method: "POST",
      signal,
      headers: requestHeaders,
      body: JSON.stringify(requestBody)
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`OpenRouter error ${res.status}: ${text}`);
    }

    const json = await res.json();
    const content =
      json.choices?.[0]?.message?.content ||
      json.choices?.[0]?.text ||
      "";
    const resHeaders = {};
    res.headers.forEach((v, k) => (resHeaders[k] = v));
    return {
      text: String(content).trim(),
      usage: json.usage || {},
      _rawRequest: {
        url,
        method: "POST",
        headers: sanitizeHeaders(requestHeaders),
        body: requestBody
      },
      _rawResponse: {
        status: res.status,
        headers: resHeaders,
        body: json
      }
    };
  }
}
