import { defineConfig } from 'wxt';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import lockfile from 'proper-lockfile';

let buildLocked = false;

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  hooks: {
    async 'build:before'(wxt) {
      if (wxt.config.command !== 'build' || buildLocked) return;

      // WXT clears the output before building. Serialize production builds,
      // including zip, and retain the lock through the final file summary.
      // All browsers also generate types in the shared .wxt directory.
      await mkdir(wxt.config.wxtDir, { recursive: true });
      const options = {
        lockfilePath: join(wxt.config.wxtDir, 'production-build.lock'),
        stale: 120_000,
        update: 10_000,
      };
      try {
        await lockfile.lock(wxt.config.root, options);
      } catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'ELOCKED') throw error;
        wxt.logger.info('Waiting for another production build to finish...');
        await lockfile.lock(wxt.config.root, {
          ...options,
          retries: { retries: 480, factor: 1, minTimeout: 250, maxTimeout: 250 },
        });
      }
      // proper-lockfile releases on process exit, including build failures
      // and handled signals; SIGKILL locks expire after the stale timeout.
      buildLocked = true;
    },
  },
});
