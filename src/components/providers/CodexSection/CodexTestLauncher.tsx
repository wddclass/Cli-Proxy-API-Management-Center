import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import type { ProviderKeyConfig } from '@/types';
import { CodexTestModal } from './CodexTestModal';

interface CodexTestLauncherProps {
  config: ProviderKeyConfig;
  disabled?: boolean;
}

export function CodexTestLauncher({ config, disabled = false }: CodexTestLauncherProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)} disabled={disabled}>
        {t('ai_providers.codex_test_action')}
      </Button>
      <CodexTestModal open={open} config={config} onClose={() => setOpen(false)} />
    </>
  );
}
