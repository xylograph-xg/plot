export interface LocalFile {
  id: string;
  name: string;
  kind: 'data' | 'project';
}

export interface FolderSnapshot {
  root: string | null;
  files: LocalFile[];
  skipped: number;
  limited?: boolean;
  error?: string;
}

interface LocalFolder {
  get(): Promise<FolderSnapshot>;
  choose(): Promise<FolderSnapshot>;
  refresh(): Promise<FolderSnapshot>;
  read(id: string): Promise<ArrayBuffer>;
  saveProject(json: string, name: string, directory: string): Promise<string | null>;
  onChange(callback: (snapshot: FolderSnapshot) => void): () => void;
}

declare global {
  interface Window {
    localFolder?: LocalFolder;
  }
}

export interface ChartEntry {
  id: string;
  label: string;
  directory: string;
}

export interface WorkspaceDirectory {
  id: string;
  name: string;
  directories: Map<string, WorkspaceDirectory>;
  files: LocalFile[];
  charts: ChartEntry[];
}

const newDirectory = (id: string, name: string): WorkspaceDirectory =>
  ({ id, name, directories: new Map(), files: [], charts: [] });

export function workspaceTree(files: LocalFile[], charts: ChartEntry[]): WorkspaceDirectory {
  const root = newDirectory('', '');
  const directory = (id: string): WorkspaceDirectory => {
    if (!id) return root;
    let node = root;
    for (const name of id.split('/')) {
      let next = node.directories.get(name);
      if (!next) {
        next = newDirectory(node.id ? node.id + '/' + name : name, name);
        node.directories.set(name, next);
      }
      node = next;
    }
    return node;
  };
  files.forEach((file) => directory(file.id.slice(0, Math.max(0, file.id.lastIndexOf('/')))).files.push(file));
  charts.forEach((chart) => directory(chart.directory).charts.push(chart));
  return root;
}
