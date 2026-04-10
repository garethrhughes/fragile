import nextConfig from 'eslint-config-next';

const config = [
  ...nextConfig,
  {
    rules: {
      // Overly strict for standard Next.js patterns (guard clauses, mount flags,
      // async loaders that call setState in finally/catch). The underlying
      // guidance is sound but the rule fires on legitimate usage too broadly.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
];

export default config;
