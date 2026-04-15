export const Colors = {
  primary: '#6a1cf6',
  primaryContainer: '#ac8eff',
  primaryDim: '#5d00e3',
  onPrimary: '#f7f0ff',
  
  secondary: '#00675d',
  secondaryContainer: '#4af8e3',
  onSecondaryContainer: '#005b51',
  
  background: '#fdf3ff',
  surface: '#fdf3ff',
  surfaceContainer: '#f3e2ff',
  surfaceContainerHigh: '#efdbff',
  surfaceContainerHighest: '#ebd4ff',
  surfaceContainerLow: '#f9edff',
  surfaceContainerLowest: '#ffffff',
  
  onSurface: '#38274c',
  onSurfaceVariant: '#67537c',
  
  error: '#b41340',
  outline: '#836e99',
  outlineVariant: '#bba4d2',
  
  white: '#ffffff',
  black: '#38274c', // We don't use pure black
  glassBg: 'rgba(253, 243, 255, 0.7)',
  readReceipt: '#4fc3f7',
  // Stubs for shared components
  light: {
    primary: '#6a1cf6',
    background: '#fdf3ff',
    text: '#38274c',
    icon: '#67537c',
  },
  dark: {
    primary: '#ac8eff',
    background: '#1a0b2e',
    text: '#f7f0ff',
    icon: '#836e99',
  }
};

export const Gradients = {
  primary: ['#6a1cf6', '#ac8eff'] as const,
  secondary: ['#4af8e3', '#00675d'] as const, 
  pulse: ['#6a1cf6', '#4af8e3', '#b70047'] as const, // Multi-stop for stories
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const Radius = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 48, // 3rem approx
  full: 9999,
};

export const Shadow = {
  ambient: {
    shadowColor: '#38274c',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 20,
    elevation: 4,
  },
  premium: {
    shadowColor: '#6a1cf6',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.15,
    shadowRadius: 30,
    elevation: 8,
  }
};
