import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';

const Dropdown = ({ value, options, onChange, minWidth = '130px', dropUp = false }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div style={{ position: 'relative' }} ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
          padding: '6px 12px',
          borderRadius: '6px',
          background: 'var(--card-bg)',
          border: '1px solid var(--border)',
          color: 'var(--text-primary)',
          cursor: 'pointer',
          fontSize: '13px',
          minWidth: minWidth,
          width: minWidth === '100%' ? '100%' : 'auto',
          textAlign: 'left'
        }}
      >
        {(() => {
          const selectedOption = options.find(opt => (typeof opt === 'object' ? opt.value : opt) === value);
          return (selectedOption && typeof selectedOption === 'object') ? selectedOption.label : value;
        })()} 
        <ChevronDown size={14} style={{ opacity: 0.7 }} />
      </button>

      {isOpen && (
        <div style={{
          position: 'absolute',
          ...(dropUp ? { bottom: '100%', marginBottom: '4px' } : { top: '100%', marginTop: '4px' }),
          right: 0,
          background: 'var(--card-bg)',
          border: '1px solid var(--border)',
          borderRadius: '6px',
          minWidth: minWidth,
          width: minWidth === '100%' ? '100%' : 'auto',
          zIndex: 100,
          boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
          maxHeight: '250px',
          overflowY: 'auto',
          overflowX: 'hidden'
        }}>
          {options.map(option => {
            const optValue = typeof option === 'object' ? option.value : option;
            const optLabel = typeof option === 'object' ? option.label : option;
            const isSelected = value === optValue;

            return (
              <div
                key={optValue}
                onClick={() => {
                  onChange(optValue);
                  setIsOpen(false);
                }}
                style={{
                  padding: '8px 12px',
                  cursor: 'pointer',
                  fontSize: '13px',
                  background: isSelected ? 'var(--border)' : 'transparent',
                  color: isSelected ? '#fbbf24' : 'var(--text-primary)',
                  transition: 'background 0.2s',
                  wordBreak: 'break-word'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                onMouseLeave={(e) => e.currentTarget.style.background = isSelected ? 'var(--border)' : 'transparent'}
              >
                {optLabel}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default Dropdown;
