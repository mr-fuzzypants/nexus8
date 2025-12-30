import React, { useState, useEffect } from 'react';
import { Box, Image, Skeleton, Center, Text } from '@mantine/core';
import { IconPhoto, IconPhotoOff } from '@tabler/icons-react';

interface AsyncImageProps {
  src?: string;
  alt?: string;
  placeholder?: string;
  width?: string | number;
  height?: string | number;
  fit?: 'contain' | 'cover' | 'fill' | 'none' | 'scale-down';
  radius?: number | string;
  fallbackIcon?: React.ReactNode;
  onLoad?: () => void;
  onError?: () => void;
  className?: string;
  style?: React.CSSProperties;
}

type LoadingState = 'loading' | 'loaded' | 'error' | 'no-image';

/**
 * AsyncImage component that handles lazy loading of images with:
 * - Loading skeleton
 * - Error handling with fallback
 * - Configurable placeholder
 * - Lazy loading with IntersectionObserver
 */
export const AsyncImage: React.FC<AsyncImageProps> = ({
  src,
  alt = 'Card image',
  placeholder = 'https://via.placeholder.com/300x200?text=No+Image',
  width = '100%',
  height = 200,
  fit = 'cover',
  radius = 'sm',
  fallbackIcon,
  onLoad,
  onError,
  className,
  style,
}) => {
  const [loadingState, setLoadingState] = useState<LoadingState>('loading');
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [isInView, setIsInView] = useState(false);
  const imgRef = React.useRef<HTMLDivElement>(null);

  // Intersection Observer for lazy loading
  useEffect(() => {
    if (!imgRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsInView(true);
            observer.disconnect();
          }
        });
      },
      {
        rootMargin: '50px', // Start loading 50px before the image is visible
      }
    );

    observer.observe(imgRef.current);

    return () => {
      observer.disconnect();
    };
  }, []);

  // Handle image loading
  useEffect(() => {
    if (!isInView) return;
    
    // No image source provided
    if (!src) {
      setLoadingState('no-image');
      setImageSrc(placeholder);
      return;
    }

    setLoadingState('loading');

    // Create a new image to preload
    const img = new window.Image();
    
    img.onload = () => {
      setImageSrc(src);
      setLoadingState('loaded');
      onLoad?.();
    };

    img.onerror = () => {
      setImageSrc(placeholder);
      setLoadingState('error');
      onError?.();
    };

    img.src = src;

    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [src, placeholder, isInView, onLoad, onError]);

  // Loading skeleton
  if (!isInView || loadingState === 'loading') {
    return (
      <Box
        ref={imgRef}
        style={{
          width,
          height,
          position: 'relative',
          overflow: 'hidden',
          borderRadius: typeof radius === 'number' ? `${radius}px` : radius,
          ...style,
        }}
        className={className}
      >
        <Skeleton width="100%" height="100%" />
        <Center
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
          }}
        >
          <IconPhoto size={48} opacity={0.3} />
        </Center>
      </Box>
    );
  }

  // Error state
  if (loadingState === 'error' && !imageSrc) {
    return (
      <Box
        style={{
          width,
          height,
          position: 'relative',
          overflow: 'hidden',
          borderRadius: typeof radius === 'number' ? `${radius}px` : radius,
          backgroundColor: 'var(--mantine-color-gray-1)',
          ...style,
        }}
        className={className}
      >
        <Center h="100%">
          {fallbackIcon || (
            <Box style={{ textAlign: 'center' }}>
              <IconPhotoOff size={48} opacity={0.3} />
              <Text size="xs" c="dimmed" mt="xs">
                Failed to load image
              </Text>
            </Box>
          )}
        </Center>
      </Box>
    );
  }

  // No image state
  if (loadingState === 'no-image') {
    return (
      <Box
        style={{
          width,
          height,
          position: 'relative',
          overflow: 'hidden',
          borderRadius: typeof radius === 'number' ? `${radius}px` : radius,
          ...style,
        }}
        className={className}
      >
        <Image
          src={placeholder}
          alt={alt}
          width={width}
          height={height}
          fit={fit}
          radius={radius}
        />
      </Box>
    );
  }

  // Successfully loaded
  return (
    <Box
      style={{
        width,
        height,
        position: 'relative',
        overflow: 'hidden',
        borderRadius: typeof radius === 'number' ? `${radius}px` : radius,
        ...style,
      }}
      className={className}
    >
      <Image
        src={imageSrc}
        alt={alt}
        width={width}
        height={height}
        fit={fit}
        radius={radius}
        style={{
          transition: 'opacity 0.3s ease-in-out',
        }}
      />
    </Box>
  );
};

/**
 * Hook to preload images
 */
export const useImagePreload = (src?: string): LoadingState => {
  const [state, setState] = useState<LoadingState>('loading');

  useEffect(() => {
    if (!src) {
      setState('no-image');
      return;
    }

    setState('loading');
    const img = new window.Image();

    img.onload = () => setState('loaded');
    img.onerror = () => setState('error');

    img.src = src;

    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [src]);

  return state;
};
