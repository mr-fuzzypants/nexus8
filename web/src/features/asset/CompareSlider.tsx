import { useState } from 'react';
import { Badge } from '@mantine/core';

interface CompareSliderProps {
  beforeSrc: string;
  beforeLabel: string;
  afterSrc: string;
  afterLabel: string;
}

/** Two-up wipe comparison: drag the slider to reveal before/after. */
export function CompareSlider({ beforeSrc, beforeLabel, afterSrc, afterLabel }: CompareSliderProps) {
  const [position, setPosition] = useState(50);

  return (
    <div className="compare-wrap">
      <img src={beforeSrc} alt={beforeLabel} draggable={false} />
      <div className="compare-after" style={{ clipPath: `inset(0 0 0 ${position}%)` }}>
        <img src={afterSrc} alt={afterLabel} draggable={false} />
      </div>
      <div className="compare-divider" style={{ left: `${position}%` }} />
      <Badge className="compare-label left" variant="filled" color="dark" size="xs">
        {beforeLabel}
      </Badge>
      <Badge className="compare-label right" variant="filled" color="teal" size="xs">
        {afterLabel}
      </Badge>
      <input
        type="range"
        min={0}
        max={100}
        value={position}
        onChange={(e) => setPosition(Number(e.currentTarget.value))}
        className="compare-range"
        aria-label="Comparison position"
      />
    </div>
  );
}
