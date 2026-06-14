import { useState } from 'react';
import { ActionIcon } from '@mantine/core';
import {
  IconHeart,
  IconHeartFilled,
  IconShoppingBag,
  IconShoppingBagCheck,
} from '@tabler/icons-react';
import clsx from 'clsx';
import { thumbUrl, type AssetSummary } from '../../api/library';
import { useLibraryStore } from '../../stores/library';
import { useBasketStore } from '../../stores/basket';

interface AssetCardProps {
  asset: AssetSummary;
  left: number;
  top: number;
  width: number;
  height: number;
  onOpen: (asset: AssetSummary) => void;
}

export function AssetCard({ asset, left, top, width, height, onOpen }: AssetCardProps) {
  const [loaded, setLoaded] = useState(false);
  const isFavorite = useLibraryStore((s) => Boolean(s.favorites[asset.id]));
  const toggleFavorite = useLibraryStore((s) => s.toggleFavorite);
  const inBasket = useBasketStore((s) => s.items.some((i) => i.asset.id === asset.id));
  const addToBasket = useBasketStore((s) => s.add);
  const removeFromBasket = useBasketStore((s) => s.remove);

  const t256 = asset.thumbnails['256'];
  const t1024 = asset.thumbnails['1024'];
  const srcSet = t256 && t1024 ? `${t256} 256w, ${t1024} 1024w` : undefined;
  const src = thumbUrl(asset, width);

  return (
    <div
      className="asset-card"
      role="button"
      tabIndex={0}
      aria-label={asset.name}
      style={{
        left,
        top,
        width,
        height,
        backgroundImage: asset.placeholder ? `url(${asset.placeholder})` : undefined,
      }}
      onClick={() => onOpen(asset)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(asset);
        }
      }}
    >
      {src && (
        <img
          src={src}
          srcSet={srcSet}
          sizes={srcSet ? `${Math.round(width)}px` : undefined}
          alt={asset.ai_description || asset.name}
          loading="lazy"
          draggable={false}
          className={clsx(loaded && 'loaded')}
          onLoad={() => setLoaded(true)}
        />
      )}
      <div className="card-overlay">
        <div className="card-actions">
          <ActionIcon
            variant="subtle"
            color={inBasket ? 'teal' : 'gray'}
            aria-label={inBasket ? 'Remove from basket' : 'Add to basket'}
            onClick={(e) => {
              e.stopPropagation();
              if (inBasket) removeFromBasket(asset.id);
              else addToBasket(asset);
            }}
          >
            {inBasket ? (
              <IconShoppingBagCheck size={16} stroke={1.75} />
            ) : (
              <IconShoppingBag size={16} stroke={1.75} />
            )}
          </ActionIcon>
          <ActionIcon
            variant="subtle"
            color={isFavorite ? 'teal' : 'gray'}
            aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
            onClick={(e) => {
              e.stopPropagation();
              toggleFavorite(asset);
            }}
          >
            {isFavorite ? <IconHeartFilled size={16} /> : <IconHeart size={16} stroke={1.75} />}
          </ActionIcon>
        </div>
        <div className="card-title">{asset.name}</div>
      </div>
    </div>
  );
}
