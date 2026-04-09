import { useCallback, useEffect, useRef, useState } from 'react';

export function useSectionCollapsed(hasContent: boolean) {
  const [collapsed, setCollapsed] = useState(() => !hasContent);
  const hasUserToggledRef = useRef(false);

  useEffect(() => {
    if (!hasUserToggledRef.current) {
      setCollapsed(!hasContent);
    }
  }, [hasContent]);

  const toggleCollapsed = useCallback(() => {
    hasUserToggledRef.current = true;
    setCollapsed((prev) => !prev);
  }, []);

  return { collapsed, toggleCollapsed };
}
