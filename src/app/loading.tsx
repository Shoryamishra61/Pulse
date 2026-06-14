export default function Loading() {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      height: '100%',
      width: '100%',
      backgroundColor: 'var(--bg-primary)'
    }}>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '24px'
      }}>
        {/* Sleek animated spinner / logo indicator */}
        <div style={{
          position: 'relative',
          width: '40px',
          height: '40px'
        }}>
          <div style={{
            position: 'absolute',
            inset: 0,
            border: '2px solid var(--border-subtle)',
            borderRadius: '50%',
          }} />
          <div style={{
            position: 'absolute',
            inset: 0,
            border: '2px solid var(--text-primary)',
            borderRadius: '50%',
            borderTopColor: 'transparent',
            animation: 'spin 0.8s linear infinite'
          }} />
        </div>
        
        {/* Subtle loading text */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '8px'
        }}>
          <div className="skeleton skeleton-title" style={{ width: '80px', height: '12px' }} />
          <div className="skeleton skeleton-text" style={{ width: '120px', height: '8px' }} />
        </div>
      </div>
      
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
