import fs from 'fs';
import path from 'path';
import os from 'os';

export interface Preferences {
  notificationsEnabled: boolean;
}

const DEFAULT_PREFERENCES: Preferences = {
  notificationsEnabled: false,
};

const CONFIG_DIR = path.join(os.homedir(), '.claude-code-remote');
const PREFERENCES_FILE = path.join(CONFIG_DIR, 'preferences.json');

function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function loadPreferences(): Preferences {
  try {
    if (fs.existsSync(PREFERENCES_FILE)) {
      const data = fs.readFileSync(PREFERENCES_FILE, 'utf-8');
      return { ...DEFAULT_PREFERENCES, ...JSON.parse(data) };
    }
  } catch {
    // Return defaults on error
  }
  return { ...DEFAULT_PREFERENCES };
}

export function savePreferences(prefs: Partial<Preferences>): Preferences {
  ensureConfigDir();
  const current = loadPreferences();
  const updated = { ...current, ...prefs };
  fs.writeFileSync(PREFERENCES_FILE, JSON.stringify(updated, null, 2));
  return updated;
}
