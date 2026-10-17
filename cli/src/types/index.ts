export type AIType = 'claude' | 'cursor' | 'windsurf' | 'antigravity' | 'copilot' | 'kiro' | 'roocode' | 'codex' | 'qoder' | 'gemini' | 'trae' | 'opencode' | 'continue' | 'codebuddy' | 'droid' | 'kilocode' | 'warp' | 'augment' | 'codewhale' | 'zcode' | 'amazonq' | 'openclaw' | 'universal' | 'all';
export type ConcreteAIType = Exclude<AIType, 'all'>;

export type InstallType = 'full' | 'reference';

export interface Release {
  tag_name: string;
  name: string;
  published_at: string;
  html_url: string;
}

export interface PlatformConfig {
  platform: string;
  displayName: string;
  installType: InstallType;
  folderStructure: {
    root: string;
    globalRoot?: string;
    skillPath: string;
    filename: string;
    dataPath?: string;
  };
  scriptPath: string;
  frontmatter: Record<string, string> | null;
  sections: {
    quickReference: boolean;
  };
  title: string;
  description: string;
  skillOrWorkflow: string;
}

export const AI_TYPES: AIType[] = ['claude', 'cursor', 'windsurf', 'antigravity', 'copilot', 'roocode', 'kiro', 'codex', 'qoder', 'gemini', 'trae', 'opencode', 'continue', 'codebuddy', 'droid', 'kilocode', 'warp', 'augment', 'codewhale', 'zcode', 'amazonq', 'openclaw', 'universal', 'all'];

// Folders that earlier installs used per platform; uninstall also cleans their skills/ dirs.
export const AI_FOLDERS: Record<ConcreteAIType, string[]> = {
  claude: ['.claude'],
  cursor: ['.cursor', '.shared'],
  windsurf: ['.windsurf', '.shared'],
  antigravity: ['.agents', '.shared'],
  copilot: ['.github', '.shared'],
  kiro: ['.kiro', '.shared'],
  codex: ['.codex'],
  roocode: ['.roo', '.shared'],
  qoder: ['.qoder', '.shared'],
  gemini: ['.gemini', '.shared'],
  trae: ['.trae', '.shared'],
  opencode: ['.opencode', '.shared'],
  continue: ['.continue'],
  codebuddy: ['.codebuddy'],
  droid: ['.factory'],
  kilocode: ['.kilocode', '.shared'],
  warp: ['.warp', '.shared'],
  augment: ['.augment', '.shared'],
  codewhale: ['.codewhale', '.shared'],
  zcode: ['.zcode', '.shared'],
  amazonq: ['.amazonq', '.shared'],
  openclaw: ['.agents', '.shared'],
  universal: ['.agents', '.shared'],
};
