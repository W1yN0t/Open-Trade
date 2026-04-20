import { readdirSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { Provider } from './base.ts';

function findProviderFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...findProviderFiles(full));
    } else if (entry === 'provider.ts' || entry === 'provider.js') {
      results.push(full);
    }
  }
  return results;
}

export async function discoverProviders(): Promise<Map<string, typeof Provider>> {
  const providersDir = dirname(fileURLToPath(import.meta.url));
  const files = findProviderFiles(providersDir);

  const registry = new Map<string, typeof Provider>();

  await Promise.all(
    files.map(async (file) => {
      const mod = await import(pathToFileURL(file).href);
      for (const exported of Object.values(mod)) {
        if (typeof exported === 'function' && exported.prototype instanceof Provider) {
          const ProviderClass = exported as typeof Provider;
          const instance = new (ProviderClass as new () => Provider)();
          registry.set(instance.name, ProviderClass);
        }
      }
    }),
  );

  return registry;
}
