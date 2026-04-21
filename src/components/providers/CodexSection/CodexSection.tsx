import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconChevronDown } from '@/components/ui/icons';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import iconCodex from '@/assets/icons/codex.svg';
import type { ProviderKeyConfig } from '@/types';
import { maskApiKey } from '@/utils/format';
import { calculateStatusBarData, type KeyStats } from '@/utils/usage';
import { type UsageDetailsByAuthIndex, type UsageDetailsBySource } from '@/utils/usageIndex';
import styles from '@/pages/AiProvidersPage.module.scss';
import { ProviderStatusBar } from '../ProviderStatusBar';
import { useSectionCollapsed } from '../hooks/useSectionCollapsed';
import {
  collectUsageDetailsForIdentity,
  getProviderConfigKey,
  getStatsForIdentity,
  hasDisableAllModelsRule,
} from '../utils';
import { CodexTestLauncher } from './CodexTestLauncher';

interface CodexSectionProps {
  configs: ProviderKeyConfig[];
  keyStats: KeyStats;
  usageDetailsBySource: UsageDetailsBySource;
  usageDetailsByAuthIndex: UsageDetailsByAuthIndex;
  loading: boolean;
  disableControls: boolean;
  isSwitching: boolean;
  onAdd: () => void;
  onEdit: (index: number) => void;
  onDelete: (index: number) => void;
  onToggle: (index: number, enabled: boolean) => void;
}

type CodexSortMode = 'added' | 'success-rate' | 'priority';

const CODEX_SORT_STORAGE_KEY = 'ai-providers:codex-sort-mode';

const isCodexSortMode = (value: string): value is CodexSortMode =>
  value === 'added' || value === 'success-rate' || value === 'priority';

type CodexViewItem = {
  config: ProviderKeyConfig;
  originalIndex: number;
  success: number;
  failure: number;
  successRate: number;
};

export function CodexSection({
  configs,
  keyStats,
  usageDetailsBySource,
  usageDetailsByAuthIndex,
  loading,
  disableControls,
  isSwitching,
  onAdd,
  onEdit,
  onDelete,
  onToggle,
}: CodexSectionProps) {
  const { t } = useTranslation();
  const [storedSortMode, setStoredSortMode] = useLocalStorage<string>(
    CODEX_SORT_STORAGE_KEY,
    'added'
  );
  const sortMode: CodexSortMode = isCodexSortMode(storedSortMode) ? storedSortMode : 'added';
  const actionsDisabled = disableControls || loading || isSwitching;
  const toggleDisabled = disableControls || loading || isSwitching;
  const { collapsed, toggleCollapsed } = useSectionCollapsed(configs.length > 0);

  const statusBarCache = useMemo(() => {
    const cache = new Map<string, ReturnType<typeof calculateStatusBarData>>();

    configs.forEach((config, index) => {
      if (!config.apiKey) return;
      const configKey = getProviderConfigKey(config, index);
      cache.set(
        configKey,
        calculateStatusBarData(
          collectUsageDetailsForIdentity(
            { authIndex: config.authIndex, apiKey: config.apiKey, prefix: config.prefix },
            usageDetailsBySource,
            usageDetailsByAuthIndex
          )
        )
      );
    });

    return cache;
  }, [configs, usageDetailsByAuthIndex, usageDetailsBySource]);

  const sortedItems = useMemo<CodexViewItem[]>(() => {
    const items = configs.map((config, originalIndex) => {
      const stats = getStatsForIdentity(
        { authIndex: config.authIndex, apiKey: config.apiKey, prefix: config.prefix },
        keyStats
      );
      const total = stats.success + stats.failure;
      return {
        config,
        originalIndex,
        success: stats.success,
        failure: stats.failure,
        successRate: total > 0 ? stats.success / total : -1,
      };
    });

    if (sortMode === 'added') {
      return items;
    }

    return [...items].sort((left, right) => {
      if (sortMode === 'success-rate') {
        if (right.successRate !== left.successRate) {
          return right.successRate - left.successRate;
        }
        if (right.success !== left.success) {
          return right.success - left.success;
        }
      } else if (sortMode === 'priority') {
        const leftPriority =
          typeof left.config.priority === 'number' && Number.isFinite(left.config.priority)
            ? left.config.priority
            : Number.NEGATIVE_INFINITY;
        const rightPriority =
          typeof right.config.priority === 'number' && Number.isFinite(right.config.priority)
            ? right.config.priority
            : Number.NEGATIVE_INFINITY;
        if (rightPriority !== leftPriority) {
          return rightPriority - leftPriority;
        }
      }

      return left.originalIndex - right.originalIndex;
    });
  }, [configs, keyStats, sortMode]);

  const sortOptions: Array<{ value: CodexSortMode; label: string }> = [
    { value: 'added', label: t('ai_providers.codex_sort_added') },
    { value: 'success-rate', label: t('ai_providers.codex_sort_success_rate') },
    { value: 'priority', label: t('ai_providers.codex_sort_priority') },
  ];

  const renderCompactStat = (
    label: string,
    value: string | number,
    tone?: 'success' | 'danger'
  ) => (
    <span
      className={`${styles.compactStat} ${
        tone === 'success'
          ? styles.compactStatSuccess
          : tone === 'danger'
            ? styles.compactStatDanger
            : ''
      }`}
    >
      <span className={styles.compactStatLabel}>{label}</span>
      <span className={styles.compactStatValue}>{value}</span>
    </span>
  );

  return (
    <>
      <Card
        title={
          <span className={styles.cardTitle}>
            <img src={iconCodex} alt="" className={styles.cardTitleIcon} />
            {t('ai_providers.codex_title')}
          </span>
        }
        extra={
          <div className={styles.headerActions}>
            <div className={styles.headerActionCluster}>
              <Button
                variant="secondary"
                size="sm"
                className={styles.collapseButton}
                onClick={toggleCollapsed}
                aria-expanded={!collapsed}
              >
                <span className={styles.collapseButtonContent}>
                  <span
                    className={`${styles.collapseButtonIcon} ${
                      collapsed ? '' : styles.collapseButtonIconExpanded
                    }`}
                  >
                    <IconChevronDown size={16} />
                  </span>
                  <span>{collapsed ? t('common.expand') : t('common.collapse')}</span>
                </span>
              </Button>
              <div className={styles.headerSortPanel}>
                <span className={styles.sortLabel}>{t('common.sort')}:</span>
                <div className={styles.sortActions}>
                  {sortOptions.map((option) => (
                    <Button
                      key={option.value}
                      variant={sortMode === option.value ? 'primary' : 'secondary'}
                      size="sm"
                      className={styles.sortButton}
                      onClick={() => setStoredSortMode(option.value)}
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
            <Button
              size="sm"
              className={styles.headerPrimaryAction}
              onClick={onAdd}
              disabled={actionsDisabled}
            >
              {t('ai_providers.codex_add_button')}
            </Button>
          </div>
        }
      >
        <div className={`${styles.sectionCollapse} ${collapsed ? '' : styles.sectionCollapseOpen}`}>
          <div className={styles.sectionCollapseInner}>
            {loading && sortedItems.length === 0 ? (
              <div className="hint">{t('common.loading')}</div>
            ) : sortedItems.length === 0 ? (
              <EmptyState
                title={t('ai_providers.codex_empty_title')}
                description={t('ai_providers.codex_empty_desc')}
              />
            ) : (
              <div className={styles.codexTableWrap}>
                <table className={styles.codexTable}>
                  <thead>
                    <tr>
                      <th>{t('common.api_key')}</th>
                      <th>{t('common.base_url')}</th>
                      <th>{t('common.prefix')}</th>
                      <th>{t('common.priority')}</th>
                      <th>{t('ai_providers.codex_models_count')}</th>
                      <th>{t('usage_stats.success_rate')}</th>
                      <th>{t('common.status')}</th>
                      <th>{t('common.action')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedItems.map((item) => {
                      const config = item.config;
                      const headerEntries = Object.entries(config.headers || {});
                      const configDisabled = hasDisableAllModelsRule(config.excludedModels);
                      const excludedModels = config.excludedModels ?? [];
                      const statusData =
                        statusBarCache.get(getProviderConfigKey(config, item.originalIndex)) ||
                        calculateStatusBarData([]);
                      const requestTotal = item.success + item.failure;
                      const successRateText =
                        requestTotal > 0 ? `${(item.successRate * 100).toFixed(1)}%` : '--';

                      return (
                        <tr
                          key={getProviderConfigKey(config, item.originalIndex)}
                          className={configDisabled ? styles.codexTableRowDisabled : ''}
                        >
                          <td>
                            <div className={styles.tablePrimaryCell}>
                              <div className={styles.tablePrimaryValue} title={config.apiKey}>
                                {maskApiKey(config.apiKey)}
                              </div>
                              <div className={styles.tableMetaLine}>
                                {renderCompactStat(t('stats.success'), item.success, 'success')}
                                {renderCompactStat(t('stats.failure'), item.failure, 'danger')}
                              </div>
                            </div>
                          </td>
                          <td>
                            <div className={styles.tableUrlCell}>
                              <span
                                className={styles.tableMonoText}
                                title={config.baseUrl || t('common.not_set')}
                              >
                                {config.baseUrl || t('common.not_set')}
                              </span>
                              {(config.proxyUrl || config.websockets !== undefined) && (
                                <div className={styles.tableMetaLine}>
                                  {config.proxyUrl ? (
                                    <span className={styles.tableBadge} title={config.proxyUrl}>
                                      Proxy
                                    </span>
                                  ) : null}
                                  {config.websockets ? (
                                    <span
                                      className={`${styles.tableBadge} ${styles.tableBadgeActive}`}
                                    >
                                      WS
                                    </span>
                                  ) : null}
                                </div>
                              )}
                            </div>
                          </td>
                          <td>
                            <span className={styles.tableMonoText}>
                              {config.prefix || t('common.not_set')}
                            </span>
                          </td>
                          <td>
                            <span className={styles.tableNumericCell}>
                              {config.priority ?? '-'}
                            </span>
                          </td>
                          <td>
                            <div className={styles.tableMetaLine}>
                              {renderCompactStat(
                                t('ai_providers.codex_models_count'),
                                config.models?.length ?? 0
                              )}
                              {excludedModels.length > 0
                                ? renderCompactStat(t('common.warning'), excludedModels.length)
                                : null}
                              {headerEntries.length > 0
                                ? renderCompactStat(
                                    t('common.custom_headers_label'),
                                    headerEntries.length
                                  )
                                : null}
                            </div>
                          </td>
                          <td>
                            <div className={styles.tableRateCell}>
                              <span className={styles.tableRateValue}>{successRateText}</span>
                              <span className={styles.tableRateHint}>
                                {requestTotal > 0 ? `${requestTotal}` : t('status_bar.no_requests')}
                              </span>
                            </div>
                          </td>
                          <td>
                            <div className={styles.tableStatusCell}>
                              {configDisabled ? (
                                <span
                                  className={`${styles.tableBadge} ${styles.tableBadgeWarning}`}
                                >
                                  {t('ai_providers.config_disabled_badge')}
                                </span>
                              ) : (
                                <span className={`${styles.tableBadge} ${styles.tableBadgeActive}`}>
                                  {t('ai_providers.config_toggle_label')}
                                </span>
                              )}
                              <ProviderStatusBar statusData={statusData} />
                            </div>
                          </td>
                          <td>
                            <div className={styles.tableActions}>
                              <div className={styles.tableToggleWrap}>
                                <ToggleSwitch
                                  ariaLabel={t('ai_providers.config_toggle_label')}
                                  checked={!configDisabled}
                                  disabled={toggleDisabled}
                                  onChange={(value) => void onToggle(item.originalIndex, value)}
                                />
                              </div>
                              <div className={styles.tableActionButtons}>
                                <CodexTestLauncher config={config} disabled={actionsDisabled} />
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => onEdit(item.originalIndex)}
                                  disabled={actionsDisabled}
                                >
                                  {t('common.edit')}
                                </Button>
                                <Button
                                  variant="danger"
                                  size="sm"
                                  onClick={() => onDelete(item.originalIndex)}
                                  disabled={actionsDisabled}
                                >
                                  {t('common.delete')}
                                </Button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </Card>
    </>
  );
}
