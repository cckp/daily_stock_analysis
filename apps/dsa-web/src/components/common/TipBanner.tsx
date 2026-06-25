import type React from 'react';
import { useEffect, useState } from 'react';
import { Info } from 'lucide-react';
import { tipsApi } from '../../api/tips';

const INTERVAL_MS = 5000;

export const TipBanner: React.FC = () => {
  const [tips, setTips] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    tipsApi.getTips().then(setTips).catch(() => {});
  }, []);

  useEffect(() => {
    if (tips.length <= 1) return;

    const timer = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setIndex((prev) => (prev + 1) % tips.length);
        setVisible(true);
      }, 350);
    }, INTERVAL_MS);

    return () => clearInterval(timer);
  }, [tips]);

  if (tips.length === 0) return null;

  return (
    <div className="flex h-8 items-center gap-2 border-b border-border/40 bg-primary/5 px-4 text-xs text-secondary-text">
      <Info className="h-3.5 w-3.5 shrink-0 text-primary/70" />
      <span
        className="min-w-0 flex-1 truncate transition-opacity duration-300"
        style={{ opacity: visible ? 1 : 0 }}
      >
        {tips[index]}
      </span>
      {tips.length > 1 && (
        <span className="shrink-0 tabular-nums text-border">
          {index + 1}/{tips.length}
        </span>
      )}
    </div>
  );
};
