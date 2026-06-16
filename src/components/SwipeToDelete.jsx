import React, { useState, useRef } from 'react';
import { Trash2 } from 'lucide-react';

export default function SwipeToDelete({ children, onDelete, itemName = 'este elemento', disabled = false }) {
  const [offset, setOffset] = useState(0);
  const startX = useRef(0);
  const startY = useRef(0);
  const currentX = useRef(0);
  const isSwiping = useRef(false);
  const isVerticalScroll = useRef(false);

  const THRESHOLD = -80; // Pixels to swipe left to trigger delete

  const handleTouchStart = (e) => {
    if (disabled) return;
    startX.current = e.touches[0].clientX;
    startY.current = e.touches[0].clientY;
    isSwiping.current = true;
    isVerticalScroll.current = false;
  };

  const handleTouchMove = (e) => {
    if (!isSwiping.current || disabled) return;
    currentX.current = e.touches[0].clientX;
    const currentY = e.touches[0].clientY;
    const diffX = currentX.current - startX.current;
    const diffY = currentY - startY.current;

    if (Math.abs(diffY) > Math.abs(diffX) && Math.abs(diffY) > 10) {
        isVerticalScroll.current = true;
    }

    if (isVerticalScroll.current) return;

    if (diffX < 0) {
      setOffset(Math.max(diffX, -120)); 
    } else {
      setOffset(0);
    }
  };

  const handleTouchEnd = () => {
    if (!isSwiping.current || disabled) return;
    isSwiping.current = false;

    if (offset <= THRESHOLD && !isVerticalScroll.current) {
      if (window.confirm(`¿Seguro que deseas eliminar ${itemName}?`)) {
        onDelete();
      }
    }
    
    setOffset(0);
  };

  return (
    <div style={{ position: 'relative', overflow: 'hidden', width: '100%', height: '100%' }}>
      <div style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        width: '100%',
        backgroundColor: '#ff4d4f',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        paddingRight: '1rem',
        color: 'white',
        zIndex: 0
      }}>
        <Trash2 size={24} />
      </div>

      <div
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        style={{
          transform: `translateX(${offset}px)`,
          transition: isSwiping.current ? 'none' : 'transform 0.3s ease-out',
          position: 'relative',
          zIndex: 1,
          width: '100%',
          height: '100%',
          backgroundColor: 'inherit'
        }}
      >
        {children}
      </div>
    </div>
  );
}
