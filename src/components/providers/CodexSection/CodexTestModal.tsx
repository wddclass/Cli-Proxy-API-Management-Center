import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AutocompleteInput } from '@/components/ui/AutocompleteInput';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { apiCallApi, getApiCallErrorMessage, modelsApi } from '@/services/api';
import { useNotificationStore } from '@/stores';
import type { ProviderKeyConfig } from '@/types';
import { hasHeader } from '@/utils/headers';
import { normalizeApiBase } from '@/utils/connection';
import { maskApiKey } from '@/utils/format';
import { hasDisableAllModelsRule } from '../utils';
import styles from '@/pages/AiProvidersPage.module.scss';

interface CodexTestModalProps {
  open: boolean;
  config: ProviderKeyConfig | null;
  onClose: () => void;
}

type TestStatus = 'idle' | 'loading' | 'success' | 'error';
type TestApiMode = 'chat' | 'responses';
type ResultViewMode = 'text' | 'json';

const TEST_TIMEOUT_MS = 30_000;
const TEST_PROMPT = 'hi';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const getErrorMessage = (err: unknown) => {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return '';
};

const stripKnownEndpointSuffixes = (baseUrl: string): string => {
  const normalized = normalizeApiBase(baseUrl);
  if (!normalized) return '';
  let trimmed = normalized.replace(/\/+$/g, '');
  trimmed = trimmed.replace(/\/v1\/models$/i, '');
  trimmed = trimmed.replace(/\/v1\/chat\/completions$/i, '');
  trimmed = trimmed.replace(/\/chat\/completions$/i, '');
  trimmed = trimmed.replace(/\/v1\/responses$/i, '');
  trimmed = trimmed.replace(/\/responses$/i, '');
  return trimmed;
};

const buildV1ChatCompletionsEndpoint = (baseUrl: string): string => {
  const trimmed = stripKnownEndpointSuffixes(baseUrl);
  if (!trimmed) return '';
  if (/\/v1\/chat\/completions$/i.test(trimmed)) return trimmed;
  if (/\/chat\/completions$/i.test(trimmed)) return trimmed;
  if (/\/v1$/i.test(trimmed)) return `${trimmed}/chat/completions`;
  return `${trimmed}/v1/chat/completions`;
};

const buildV1ResponsesEndpoint = (baseUrl: string): string => {
  const trimmed = stripKnownEndpointSuffixes(baseUrl);
  if (!trimmed) return '';
  if (/\/v1\/responses$/i.test(trimmed)) return trimmed;
  if (/\/responses$/i.test(trimmed)) return trimmed;
  if (/\/v1$/i.test(trimmed)) return `${trimmed}/responses`;
  return `${trimmed}/v1/responses`;
};

const getPreferredTestMode = (baseUrl: string): TestApiMode => {
  const normalized = normalizeApiBase(baseUrl);
  if (/\/v1\/responses$/i.test(normalized) || /\/responses$/i.test(normalized)) {
    return 'responses';
  }
  return 'chat';
};

const contentToText = (content: unknown): string => {
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') return item;
        if (!isRecord(item)) return '';
        if (typeof item.text === 'string') return item.text;
        if (typeof item.content === 'string') return item.content;
        return '';
      })
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  if (isRecord(content)) {
    if (typeof content.text === 'string') return content.text.trim();
    if (typeof content.content === 'string') return content.content.trim();
  }
  return '';
};

const extractResponseText = (payload: unknown): string => {
  if (!payload) return '';
  if (typeof payload === 'string') return payload.trim();

  if (isRecord(payload)) {
    const outputText = payload.output_text;
    if (typeof outputText === 'string' && outputText.trim()) {
      return outputText.trim();
    }

    const choices = payload.choices;
    if (Array.isArray(choices)) {
      for (const choice of choices) {
        if (!isRecord(choice)) continue;
        const message = choice.message;
        if (isRecord(message)) {
          const text = contentToText(message.content);
          if (text) return text;
        }
        const delta = choice.delta;
        if (isRecord(delta)) {
          const text = contentToText(delta.content);
          if (text) return text;
        }
        const text = contentToText(choice.text);
        if (text) return text;
      }
    }

    const output = payload.output;
    if (Array.isArray(output)) {
      for (const item of output) {
        if (!isRecord(item)) continue;
        const text = contentToText(item.content);
        if (text) return text;
      }
    }
  }

  return '';
};

const shouldFallbackToAlternateApi = (statusCode: number, message: string): boolean => {
  if ([404, 405, 410, 501].includes(statusCode)) return true;
  const normalized = message.toLowerCase();
  return (
    normalized.includes('not found') ||
    normalized.includes('unsupported') ||
    normalized.includes('unknown') ||
    normalized.includes('no route') ||
    normalized.includes('no handler') ||
    normalized.includes('invalid url')
  );
};

export function CodexTestModal({ open, config, onClose }: CodexTestModalProps) {
  const { t } = useTranslation();
  const { showNotification } = useNotificationStore();
  const [availableModels, setAvailableModels] = useState<Array<{ name: string; alias?: string }>>(
    []
  );
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsError, setModelsError] = useState('');
  const [modelInput, setModelInput] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [testStatus, setTestStatus] = useState<TestStatus>('idle');
  const [testOutput, setTestOutput] = useState('');
  const [testError, setTestError] = useState('');
  const [resultBody, setResultBody] = useState<unknown>(null);
  const [resultBodyText, setResultBodyText] = useState('');
  const [resultViewMode, setResultViewMode] = useState<ResultViewMode>('text');
  const [lastUsedApiMode, setLastUsedApiMode] = useState<TestApiMode | null>(null);
  const [usedFallback, setUsedFallback] = useState(false);
  const requestIdRef = useRef(0);

  const configHeaders = useMemo(() => {
    if (!config?.headers) return {};
    return Object.entries(config.headers).reduce<Record<string, string>>((acc, [key, value]) => {
      const normalizedKey = String(key ?? '').trim();
      const normalizedValue = String(value ?? '').trim();
      if (normalizedKey && normalizedValue) {
        acc[normalizedKey] = normalizedValue;
      }
      return acc;
    }, {});
  }, [config?.headers]);

  const modelsEndpoint = useMemo(
    () => modelsApi.buildV1ModelsEndpoint(config?.baseUrl ?? ''),
    [config?.baseUrl]
  );
  const testEndpoint = useMemo(
    () => buildV1ChatCompletionsEndpoint(config?.baseUrl ?? ''),
    [config?.baseUrl]
  );
  const responsesEndpoint = useMemo(
    () => buildV1ResponsesEndpoint(config?.baseUrl ?? ''),
    [config?.baseUrl]
  );
  const disabledConfig = Boolean(config && hasDisableAllModelsRule(config.excludedModels));
  const modelOptions = useMemo<Array<{ value: string; label: string }>>(() => {
    const query = modelInput.trim().toLowerCase();
    const options = availableModels.map((model) => ({
      value: model.name,
      label:
        model.alias && model.alias !== model.name ? `${model.name} (${model.alias})` : model.name,
    }));
    if (selectedModel && modelInput.trim() === selectedModel.trim()) {
      return options;
    }
    if (!query) return options;
    return options.filter(
      (option) =>
        option.value.toLowerCase().includes(query) || option.label.toLowerCase().includes(query)
    );
  }, [availableModels, modelInput, selectedModel]);
  const currentTestModel = selectedModel.trim() || modelInput.trim();
  const modelsLoadedCount = availableModels.length;
  const preferredMode = useMemo(
    () => getPreferredTestMode(config?.baseUrl ?? ''),
    [config?.baseUrl]
  );
  const displayedTestEndpoint =
    lastUsedApiMode === 'responses'
      ? responsesEndpoint
      : lastUsedApiMode === 'chat'
        ? testEndpoint
        : preferredMode === 'responses'
          ? responsesEndpoint
          : testEndpoint;

  useEffect(() => {
    if (!open || !config) return;

    const requestId = (requestIdRef.current += 1);
    setAvailableModels([]);
    setLoadingModels(true);
    setModelsError('');
    setModelInput('');
    setSelectedModel('');
    setTestStatus('idle');
    setTestOutput('');
    setTestError('');
    setResultBody(null);
    setResultBodyText('');
    setResultViewMode('text');
    setLastUsedApiMode(null);
    setUsedFallback(false);

    if (!modelsEndpoint) {
      setLoadingModels(false);
      setModelsError(t('notification.codex_base_url_required'));
      return;
    }

    const hasCustomAuthorization = hasHeader(configHeaders, 'authorization');
    const apiKey = config.apiKey?.trim() || undefined;

    void modelsApi
      .fetchV1ModelsViaApiCall(
        modelsEndpoint,
        hasCustomAuthorization ? undefined : apiKey,
        configHeaders
      )
      .then((list) => {
        if (requestIdRef.current !== requestId) return;
        setAvailableModels(list);
        setSelectedModel(list[0]?.name ?? '');
        setModelInput(list[0]?.name ?? '');
      })
      .catch((err: unknown) => {
        if (requestIdRef.current !== requestId) return;
        const message = getErrorMessage(err);
        setModelsError(`${t('ai_providers.codex_models_fetch_error')}: ${message}`);
      })
      .finally(() => {
        if (requestIdRef.current === requestId) {
          setLoadingModels(false);
        }
      });
  }, [config, configHeaders, modelsEndpoint, open, t]);

  useEffect(() => {
    if (open) return;
    requestIdRef.current += 1;
    setLoadingModels(false);
  }, [open]);

  const handleRefreshModels = async () => {
    if (!config) return;
    const requestId = (requestIdRef.current += 1);
    setLoadingModels(true);
    setModelsError('');
    setAvailableModels([]);
    setModelInput('');
    setSelectedModel('');

    if (!modelsEndpoint) {
      setLoadingModels(false);
      setModelsError(t('notification.codex_base_url_required'));
      return;
    }

    const hasCustomAuthorization = hasHeader(configHeaders, 'authorization');
    const apiKey = config.apiKey?.trim() || undefined;

    try {
      const list = await modelsApi.fetchV1ModelsViaApiCall(
        modelsEndpoint,
        hasCustomAuthorization ? undefined : apiKey,
        configHeaders
      );
      if (requestIdRef.current !== requestId) return;
      setAvailableModels(list);
      setSelectedModel(list[0]?.name ?? '');
      setModelInput(list[0]?.name ?? '');
    } catch (err: unknown) {
      if (requestIdRef.current !== requestId) return;
      const message = getErrorMessage(err);
      setModelsError(`${t('ai_providers.codex_models_fetch_error')}: ${message}`);
    } finally {
      if (requestIdRef.current === requestId) {
        setLoadingModels(false);
      }
    }
  };

  const sendChatCompletionsRequest = async (
    endpoint: string,
    headers: Record<string, string>,
    modelName: string
  ) =>
    apiCallApi.request(
      {
        method: 'POST',
        url: endpoint,
        header: Object.keys(headers).length ? headers : undefined,
        data: JSON.stringify({
          model: modelName,
          messages: [{ role: 'user', content: TEST_PROMPT }],
          stream: false,
          max_tokens: 128,
        }),
      },
      { timeout: TEST_TIMEOUT_MS }
    );

  const sendResponsesRequest = async (
    endpoint: string,
    headers: Record<string, string>,
    modelName: string
  ) =>
    apiCallApi.request(
      {
        method: 'POST',
        url: endpoint,
        header: Object.keys(headers).length ? headers : undefined,
        data: JSON.stringify({
          model: modelName,
          input: TEST_PROMPT,
          max_output_tokens: 128,
        }),
      },
      { timeout: TEST_TIMEOUT_MS }
    );

  const handleRunTest = async () => {
    if (!config) return;
    if (!testEndpoint || !responsesEndpoint) {
      const message = t('notification.codex_base_url_required');
      setTestStatus('error');
      setTestError(message);
      showNotification(message, 'error');
      return;
    }
    if (!currentTestModel) {
      const message = t('notification.codex_test_model_required');
      setTestStatus('error');
      setTestError(message);
      showNotification(message, 'error');
      return;
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...configHeaders,
    };
    if (config.apiKey?.trim() && !hasHeader(headers, 'authorization')) {
      headers.Authorization = `Bearer ${config.apiKey.trim()}`;
    }

    setTestStatus('loading');
    setTestOutput('');
    setTestError('');
    setResultBody(null);
    setResultBodyText('');
    setResultViewMode('text');
    setLastUsedApiMode(null);
    setUsedFallback(false);

    try {
      const requestSequence: Array<{ mode: TestApiMode; endpoint: string }> =
        preferredMode === 'responses'
          ? [
              { mode: 'responses', endpoint: responsesEndpoint },
              { mode: 'chat', endpoint: testEndpoint },
            ]
          : [
              { mode: 'chat', endpoint: testEndpoint },
              { mode: 'responses', endpoint: responsesEndpoint },
            ];

      let successResult: Awaited<ReturnType<typeof apiCallApi.request>> | null = null;
      let successMode: TestApiMode | null = null;
      let previousErrorMessage = '';

      for (let index = 0; index < requestSequence.length; index += 1) {
        const item = requestSequence[index];
        const result =
          item.mode === 'chat'
            ? await sendChatCompletionsRequest(item.endpoint, headers, currentTestModel)
            : await sendResponsesRequest(item.endpoint, headers, currentTestModel);

        if (result.statusCode >= 200 && result.statusCode < 300) {
          successResult = result;
          successMode = item.mode;
          setUsedFallback(index > 0);
          break;
        }

        const message = getApiCallErrorMessage(result);
        if (index === 0 && shouldFallbackToAlternateApi(result.statusCode, message)) {
          previousErrorMessage = message;
          continue;
        }

        throw new Error(message);
      }

      if (!successResult || !successMode) {
        throw new Error(previousErrorMessage || t('notification.update_failed'));
      }

      const content = extractResponseText(successResult.body);
      const normalizedBody =
        typeof successResult.body === 'string'
          ? (() => {
              try {
                return JSON.parse(successResult.body);
              } catch {
                return successResult.body;
              }
            })()
          : successResult.body;
      setLastUsedApiMode(successMode);
      setTestStatus('success');
      setResultBody(normalizedBody);
      setResultBodyText(successResult.bodyText || '');
      setResultViewMode('text');
      setTestOutput(content || successResult.bodyText || t('ai_providers.codex_test_empty_result'));
    } catch (err: unknown) {
      const message = getErrorMessage(err);
      const errorCode =
        typeof err === 'object' && err !== null && 'code' in err
          ? String((err as { code?: string }).code)
          : '';
      const isTimeout = errorCode === 'ECONNABORTED' || message.toLowerCase().includes('timeout');
      setTestStatus('error');
      setTestError(
        isTimeout
          ? t('ai_providers.codex_test_timeout', { seconds: TEST_TIMEOUT_MS / 1000 })
          : message
      );
    }
  };

  const handleModelInputChange = (value: string) => {
    setModelInput(value);
    if (availableModels.some((model) => model.name === value)) {
      setSelectedModel(value);
      return;
    }
    setSelectedModel('');
  };

  const formattedJsonResult = useMemo(() => {
    if (resultBody === null || resultBody === undefined) return '';
    if (typeof resultBody === 'string') {
      try {
        return JSON.stringify(JSON.parse(resultBody), null, 2);
      } catch {
        return resultBody;
      }
    }
    try {
      return JSON.stringify(resultBody, null, 2);
    } catch {
      return resultBodyText;
    }
  }, [resultBody, resultBodyText]);

  const footer = (
    <>
      <Button variant="secondary" onClick={onClose}>
        {t('common.close')}
      </Button>
      <Button
        onClick={() => void handleRunTest()}
        loading={testStatus === 'loading'}
        disabled={loadingModels || !currentTestModel}
      >
        {testStatus === 'success' || testStatus === 'error'
          ? t('ai_providers.codex_test_retry')
          : t('ai_providers.codex_test_start')}
      </Button>
    </>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={760}
      title={t('ai_providers.codex_test_modal_title')}
      footer={footer}
    >
      {config ? (
        <div className={styles.codexTestModalBody}>
          <div className={styles.codexTestAccountCard}>
            <div className={styles.codexTestAccountInfo}>
              <div className={styles.codexTestAccountLogo}>C</div>
              <div className={styles.codexTestAccountMeta}>
                <div className={styles.codexTestAccountName}>Codex</div>
                <div className={styles.codexTestAccountSubline}>
                  <span className={styles.codexTestAccountTag}>APIKEY</span>
                  <span className={styles.codexTestAccountValue}>{maskApiKey(config.apiKey)}</span>
                </div>
                <div className={styles.codexTestAccountUrl} title={config.baseUrl || ''}>
                  {config.baseUrl || t('common.not_set')}
                </div>
              </div>
            </div>
            <div className={styles.codexTestAccountAside}>
              <div className={styles.codexTestBadgeRow}>
                <span
                  className={`${styles.codexTestAccountStatus} ${
                    disabledConfig ? styles.codexTestAccountStatusDisabled : ''
                  }`}
                >
                  {disabledConfig
                    ? t('ai_providers.config_disabled_badge')
                    : t('ai_providers.config_toggle_label')}
                </span>
                <span className={styles.codexTestInfoBadge}>
                  {t('ai_providers.codex_test_models_loaded', { count: modelsLoadedCount })}
                </span>
              </div>
              <div className={styles.codexTestSubHint}>
                {t('ai_providers.codex_test_fallback_hint')}
              </div>
            </div>
          </div>

          <div className={styles.codexTestControlBlock}>
            <div className={styles.modelTestMeta}>
              <label className={styles.modelTestLabel}>
                {t('ai_providers.codex_test_model_label')}
              </label>
              <span className={styles.modelTestHint}>
                {t('ai_providers.codex_test_model_hint')}
              </span>
            </div>
            <div className={styles.codexTestControlActions}>
              <AutocompleteInput
                value={modelInput}
                onChange={handleModelInputChange}
                options={modelOptions}
                filterText={
                  selectedModel && modelInput.trim() === selectedModel.trim() ? '' : modelInput
                }
                placeholder={
                  loadingModels
                    ? t('ai_providers.codex_models_fetch_loading')
                    : availableModels.length
                      ? t('ai_providers.codex_test_select_placeholder')
                      : t('ai_providers.codex_test_select_empty')
                }
                disabled={loadingModels || testStatus === 'loading' || availableModels.length === 0}
                wrapperClassName={styles.codexTestAutocomplete}
                wrapperStyle={{ marginBottom: 0 }}
                className={styles.codexTestAutocompleteInput}
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void handleRefreshModels()}
                loading={loadingModels}
                disabled={testStatus === 'loading'}
                className={styles.codexTestRefreshButton}
              >
                {t('ai_providers.codex_models_fetch_refresh')}
              </Button>
            </div>
          </div>

          <div className={styles.codexTestConsole}>
            <div className={styles.codexTestConsoleToolbar}>
              <div className={styles.codexTestConsoleToolbarLabel}>
                {t('ai_providers.codex_test_result_label')}
              </div>
              <div className={styles.codexTestConsoleViewActions}>
                <Button
                  variant={resultViewMode === 'text' ? 'primary' : 'secondary'}
                  size="sm"
                  onClick={() => setResultViewMode('text')}
                  disabled={testStatus === 'loading'}
                  className={styles.codexTestViewButton}
                >
                  {t('ai_providers.codex_test_view_text')}
                </Button>
                <Button
                  variant={resultViewMode === 'json' ? 'primary' : 'secondary'}
                  size="sm"
                  onClick={() => setResultViewMode('json')}
                  disabled={testStatus === 'loading' || (!formattedJsonResult && !resultBodyText)}
                  className={styles.codexTestViewButton}
                >
                  {t('ai_providers.codex_test_view_json')}
                </Button>
              </div>
            </div>
            <div className={styles.codexTestConsoleLineMuted}>
              {t('ai_providers.codex_test_models_url', {
                url: modelsEndpoint || t('common.not_set'),
              })}
            </div>
            <div className={styles.codexTestConsoleLineMuted}>
              {t('ai_providers.codex_test_request_url', {
                url: displayedTestEndpoint || t('common.not_set'),
              })}
            </div>
            <div className={styles.codexTestConsoleLineMuted}>
              {t('ai_providers.codex_test_prompt_label', { prompt: TEST_PROMPT })}
            </div>
            <div className={styles.codexTestConsoleLineMuted}>
              {t('ai_providers.codex_test_strategy', {
                strategy: `${testEndpoint} -> ${responsesEndpoint}`,
              })}
            </div>

            {loadingModels ? (
              <div className={styles.codexTestConsoleLineInfo}>
                {t('ai_providers.codex_models_fetch_loading')}
              </div>
            ) : modelsError ? (
              <div className={styles.codexTestConsoleLineError}>{modelsError}</div>
            ) : availableModels.length === 0 ? (
              <div className={styles.codexTestConsoleLineMuted}>
                {t('ai_providers.codex_models_fetch_empty')}
              </div>
            ) : null}

            {testStatus === 'idle' && !testOutput && !testError ? (
              <div className={styles.codexTestConsoleLineMuted}>
                {t('ai_providers.codex_test_ready')}
              </div>
            ) : null}
            {testStatus === 'loading' ? (
              <div className={styles.codexTestConsoleLineInfo}>
                {t('ai_providers.codex_test_running')}
              </div>
            ) : null}
            {testStatus === 'success' ? (
              <>
                <div className={styles.codexTestConsoleLineSuccess}>
                  {t('ai_providers.codex_test_success')}
                </div>
                <div className={styles.codexTestConsoleLineMuted}>
                  {t('ai_providers.codex_test_mode_used', {
                    mode:
                      lastUsedApiMode === 'responses' ? '/v1/responses' : '/v1/chat/completions',
                  })}
                </div>
                {usedFallback ? (
                  <div className={styles.codexTestConsoleLineInfo}>
                    {t('ai_providers.codex_test_fallback_used')}
                  </div>
                ) : null}
                <div className={styles.codexTestResultBlock}>
                  <div className={styles.codexTestResultTitle}>
                    {resultViewMode === 'json'
                      ? t('ai_providers.codex_test_result_json_title')
                      : t('ai_providers.codex_test_result_text_title')}
                  </div>
                  <pre className={styles.codexTestOutput}>
                    {resultViewMode === 'json'
                      ? formattedJsonResult || resultBodyText || testOutput
                      : testOutput}
                  </pre>
                </div>
              </>
            ) : null}
            {testStatus === 'error' ? (
              <div className={styles.codexTestConsoleLineError}>{testError}</div>
            ) : null}
          </div>

          <div className={styles.codexTestFooterMeta}>
            <span>
              {t('ai_providers.codex_test_selected_model', {
                model: currentTestModel || t('common.not_set'),
              })}
            </span>
            <span>{t('ai_providers.codex_test_prompt_text')}</span>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
