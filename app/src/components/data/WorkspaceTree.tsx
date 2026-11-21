import { useTranslation } from 'react-i18next';
import type { LocalFile, WorkspaceDirectory } from '../../lib/localFolder';

interface Props {
  node: WorkspaceDirectory;
  expanded: ReadonlySet<string>;
  searching: boolean;
  activeFile?: string;
  activeChart?: string;
  loading: string | null;
  toggle(id: string, open: boolean): void;
  onFile(file: LocalFile): void;
  onChart(id: string): void;
}

export function WorkspaceTree({ node, ...props }: Props) {
  const { t } = useTranslation();
  const folders = [...node.directories.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return (
    <ul className={node.id ? 'ml-2.5 pl-1.5 border-l border-(--border)' : ''}>
      {folders.map((folder) => {
        const open = props.searching || props.expanded.has(folder.id);
        return (
          <li key={folder.id}>
            <button type="button" className="workspace-row font-medium" title={folder.id} aria-expanded={open}
              onClick={() => props.toggle(folder.id, open)}>
              <span aria-hidden="true" className="w-3 shrink-0 text-(--text-3)">{open ? '▾' : '▸'}</span>
              <span className="truncate">{folder.name}</span>
            </button>
            {open && <WorkspaceTree node={folder} {...props} />}
          </li>
        );
      })}
      {node.files.map((file) => (
        <li key={file.id}>
          <button type="button" className="workspace-row" title={file.id}
            aria-pressed={props.activeFile === file.id} onClick={() => props.onFile(file)}>
            <span aria-hidden="true" className="w-3 shrink-0 text-(--text-3)">{file.kind === 'project' ? '▧' : '·'}</span>
            <span className="truncate">{file.name}</span>
            {props.loading === file.id && <span aria-hidden="true">…</span>}
          </button>
        </li>
      ))}
      {node.charts.length > 0 && (
        <li>
          <div className="px-1.5 pt-1 text-[10px] text-(--text-3)">{t('files.currentCharts')}</div>
          <ul>
            {node.charts.map((chart) => (
              <li key={chart.id}>
                <button type="button" className="workspace-row" title={chart.label}
                  aria-pressed={props.activeChart === chart.id} onClick={() => props.onChart(chart.id)}>
                  <span aria-hidden="true" className="w-3 shrink-0 text-(--color-accent)">▥</span>
                  <span className="truncate">{chart.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </li>
      )}
    </ul>
  );
}
