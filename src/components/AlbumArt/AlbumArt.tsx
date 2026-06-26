import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Music2 } from 'lucide-react';
import './AlbumArt.css';

interface AlbumArtProps {
  src?: string | null;
  alt?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const AlbumArt: React.FC<AlbumArtProps> = ({
  src,
  alt = 'Album art',
  size = 'md',
  className = '',
}) => (
  <div className={`album-art album-art--${size} ${className}`}>
    <AnimatePresence mode="wait">
      {src ? (
        <motion.img
          key={src}
          src={src}
          alt={alt}
          className="album-art__img"
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.4 }}
          loading="lazy"
        />
      ) : (
        <motion.div
          key="placeholder"
          className="album-art__placeholder"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <Music2 size={size === 'lg' ? 48 : size === 'md' ? 32 : 20} />
        </motion.div>
      )}
    </AnimatePresence>
    <div className="album-art__shine" />
  </div>
);

export default AlbumArt;
