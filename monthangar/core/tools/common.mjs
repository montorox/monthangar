/* shared helpers for the node tools */
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
/* The studio holds node_modules, .venv and the shared aircraft library. MONTHANGAR_HOME wins. */
export const studioDir = () => process.env.MONTHANGAR_HOME || path.join(os.homedir(), 'MontHangarStudio');
