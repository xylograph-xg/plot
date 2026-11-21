import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../../store/useStore';
import { chartLabel, chartSources, commonSourceDirectory, datasetSource, pathParents } from '../../lib/chartSources';
import { parseProject } from '../../lib/export';
import { datasetFromTable, inspectFile, type ImportTable } from '../../lib/parse';
import { workspaceTree, type FolderSnapshot, type LocalFile } from '../../lib/localFolder';
import { visibleRowIndices } from '../../lib/rowFilter';
import { supportsTrendline } from '../../lib/xySeries';
import type { Dataset, ProjectFile } from '../../types';
import { DataTable } from './DataTable';
import { RowFilterEditor } from './RowFilterEditor';
import { WorkspaceTree } from './WorkspaceTree';

interface OpenFile {
  root: string;
  file: LocalFile;
  tables: ImportTable[];
  sheet: number;
  header: boolean;
}

interface SavedFigure {
  file: LocalFile;
  project: ProjectFile;
}

function SourceList({ sources, root, files, onSource }: {
  sources: Dataset[];
  root: string | null;
  files: ReadonlySet<string>;
  onSource?: (dataset: Dataset) => void;
}) {
  const { t } = useTranslation();
  if (!sources.length) return <p className="text-(--text-3)">{t('files.noSources')}</p>;
  return (
    <ul className="space-y-1">
      {sources.map((dataset) => {
        const source = datasetSource(dataset);
        const path = source ? (source.root === root ? source.fileId : source.root + '/' + source.fileId) : dataset.name;
        const label = (
          <>
            <span className="block break-all">{path}</span>
            {source?.sheet && <span className="block text-(--text-3)">{t('files.sheet')} · {source.sheet}</span>}
            {source?.root === root && !files.has(source.fileId) && (
              <span className="block text-(--text-3)">{t('files.snapshotOnly')}</span>
            )}
          </>
        );
        return (
          <li key={dataset.id}>
            {onSource ? (
              <button type="button" className="block w-full cursor-pointer rounded px-1.5 py-1 text-left hover:bg-(--bg-subtle)"
                title={path} onClick={() => onSource(dataset)}>{label}</button>
            ) : <div className="px-1.5 py-1">{label}</div>}
          </li>
        );
      })}
    </ul>
  );
}

export function DataPanel() {
  const { t } = useTranslation();
  const folder = window.localFolder;
  const datasets = useStore((state) => state.datasets);
  const dataset = useStore((state) => state.datasets.find((d) => d.id === state.activeDatasetId));
  const charts = useStore((state) => state.charts);
  const chart = useStore((state) => state.charts.find((c) => c.id === state.activeChartId));
  const [snapshot, setSnapshot] = useState<FolderSnapshot>({ root: null, files: [], skipped: 0 });
  const [opened, setOpened] = useState<OpenFile | null>(null);
  const [selected, setSelected] = useState<'chart' | SavedFigure | null>(null);
  const [merging, setMerging] = useState(false);
  const [mergeIds, setMergeIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedPath, setSavedPath] = useState('');
  const [error, setError] = useState('');
  const request = useRef(0);
  const currentRoot = useRef<string | null>(null);
  const parsedFiles = useRef(new Map<string, OpenFile>());

  useEffect(() => {
    if (!folder) return;
    let subscribed = true;
    let receivedChange = false;
    const loadSnapshot = (next: FolderSnapshot) => {
      if (!subscribed) return;
      if (next.root !== currentRoot.current) {
        currentRoot.current = next.root;
        request.current += 1;
        setLoading(null);
        setOpened(null);
        setSelected(null);
        setMerging(false);
        setMergeIds(new Set());
        parsedFiles.current.clear();
        setExpanded(new Set());
        setSearch('');
        setSavedPath('');
      }
      setSnapshot(next);
    };
    const unsubscribe = folder.onChange((next) => {
      receivedChange = true;
      loadSnapshot(next);
    });
    void folder.get().then((next) => {
      if (!receivedChange) loadSnapshot(next);
    }).catch(() => { if (subscribed) setError(t('files.folderError')); });
    return () => {
      subscribed = false;
      unsubscribe();
    };
  }, [folder, t]);

  const query = search.trim().toLocaleLowerCase();
  const files = useMemo(() => snapshot.files.filter((file) => file.id.toLocaleLowerCase().includes(query)), [query, snapshot.files]);
  const { tree, figureSources } = useMemo(() => {
    const allSources = new Map<string, Dataset>();
    const entries = charts.flatMap((item, index) => {
      const sources = chartSources(item, datasets);
      if (!sources.length) return [];
      sources.forEach((source) => allSources.set(source.id, source));
      const label = chartLabel(item, index, (panel) => t('files.untitledChart', { panel }));
      const directory = commonSourceDirectory(sources, snapshot.root);
      const paths = sources.map((data) => datasetSource(data)?.fileId ?? data.name);
      return [label, ...paths].some((value) => value.toLocaleLowerCase().includes(query))
        ? [{ id: item.id, label, directory }]
        : [];
    });
    return { tree: workspaceTree(files, entries), figureSources: [...allSources.values()] };
  }, [charts, datasets, files, query, snapshot.root, t]);
  const fileIds = useMemo(() => new Set(snapshot.files.map((file) => file.id)), [snapshot.files]);
  const rowIndices = useMemo(() => dataset ? visibleRowIndices(dataset) : [], [dataset]);
  const filePresent = opened && fileIds.has(opened.file.id);
  const activeSources = selected === 'chart' && chart ? chartSources(chart, datasets) : null;
  const showDataset = dataset && (!selected || activeSources?.some((source) => source.id === dataset.id));
  const viewedSource = dataset && datasetSource(dataset);
  const currentFile = opened && viewedSource?.root === opened.root && viewedSource.fileId === opened.file.id ? opened : null;
  const activeFile = selected && selected !== 'chart'
    ? selected.file.id
    : viewedSource?.root === snapshot.root ? viewedSource?.fileId : undefined;
  const hasEntries = tree.files.length > 0 || tree.directories.size > 0 || tree.charts.length > 0;
  const mergeChoices = useMemo(() => charts.flatMap((item, index) =>
    supportsTrendline(item.type) && chartSources(item, datasets).length
      ? [{ id: item.id, label: chartLabel(item, index, (panel) => t('files.untitledChart', { panel })) }]
      : []), [charts, datasets, t]);

  const expandTo = (id: string) => {
    setExpanded((entries) => new Set([...entries, ...pathParents(id)]));
  };

  const selectSheet = (source: OpenFile, index: number, reload = false) => {
    const table = source.tables[index];
    if (!table) return;
    const id = JSON.stringify([source.root, source.file.id, table.name]);
    const state = useStore.getState();
    const existing = state.datasets.find((item) => {
      if (item.id === id) return true;
      const saved = item.source;
      return table.sheet !== undefined && saved?.root === source.root && saved.fileId === source.file.id && saved.sheet === table.sheet;
    });
    if (existing && !reload) state.focusLocalDataset(existing.id);
    else state.openLocalDataset({
      ...datasetFromTable(table, existing?.id ?? id),
      source: { root: source.root, fileId: source.file.id, sheet: table.sheet, firstRowHeader: source.header },
    });
    const next = { ...source, sheet: index };
    parsedFiles.current.delete(source.file.id);
    parsedFiles.current.set(source.file.id, next);
    const oldest = parsedFiles.current.keys().next().value;
    if (parsedFiles.current.size > 4 && oldest !== undefined) parsedFiles.current.delete(oldest);
    setSelected(null);
    setOpened(next);
  };

  const openFile = async (file: LocalFile, options?: { reload: boolean; header?: boolean }) => {
    if (!folder || !snapshot.root) return;
    const root = snapshot.root;
    const version = ++request.current;
    setError('');
    const cached = parsedFiles.current.get(file.id);
    if (cached && !options?.reload) {
      setLoading(null);
      selectSheet(cached, cached.sheet);
      return;
    }
    setLoading(file.id);
    try {
      const bytes = await folder.read(file.id);
      if (version !== request.current) return;
      if (file.kind === 'project') {
        const project = parseProject(new TextDecoder().decode(bytes));
        setSelected({ file, project });
        setOpened(null);
        return;
      }
      const storedSource = datasets.map(datasetSource).find((item) => item?.root === root && item.fileId === file.id);
      const header = options?.header ?? cached?.header ?? storedSource?.firstRowHeader ?? true;
      const tables = await inspectFile(new File([bytes], file.name), header);
      if (version !== request.current) return;
      if (tables.length === 0) throw new Error('No worksheets');
      const preferredSheet = cached?.tables[cached.sheet]?.sheet ?? storedSource?.sheet;
      const firstDataSheet = /^(?:说明|readme)$/i.test(tables[0].sheet ?? '')
        ? tables.findIndex((table, index) => index > 0 && table.rows.some((row) =>
          row.filter((value) => typeof value === 'number').length >= 2)) : 0;
      const preferredIndex = tables.findIndex((table) => table.sheet === preferredSheet);
      const sheet = preferredIndex >= 0 ? preferredIndex : Math.max(0, firstDataSheet);
      selectSheet({ root, file, tables, sheet, header }, sheet, options?.reload);
    } catch {
      if (version === request.current) setError(t('files.readError', { name: file.id }));
    } finally {
      if (version === request.current) setLoading(null);
    }
  };

  const selectChart = (id: string) => {
    request.current += 1;
    setLoading(null);
    setOpened(null);
    setError('');
    setSelected('chart');
    useStore.getState().setActiveChart(id, 'single');
  };

  const mergeSelected = () => {
    const state = useStore.getState();
    let index = 1;
    while (state.charts.some((item) => item.title === t('files.overlayTitle', { index }))) index += 1;
    const ids = mergeChoices.filter(({ id }) => mergeIds.has(id)).map(({ id }) => id);
    if (state.mergeCharts(ids, t('files.overlayTitle', { index }))) {
      setMerging(false);
      setMergeIds(new Set());
      selectChart(useStore.getState().activeChartId);
    }
  };

  const selectSource = (sourceDataset: Dataset) => {
    const source = datasetSource(sourceDataset);
    if (source?.root === snapshot.root && fileIds.has(source.fileId)) {
      setSearch('');
      expandTo(source.fileId);
    }
    useStore.getState().setActiveDataset(sourceDataset.id);
  };

  const changeFolder = async (choose: boolean) => {
    if (!folder) return;
    setError('');
    try {
      if (choose) await folder.choose();
      else await folder.refresh();
    } catch {
      setError(t('files.folderError'));
    }
  };

  const saveFigure = async () => {
    if (!folder || !snapshot.root || saving) return;
    const root = snapshot.root;
    setError('');
    setSaving(true);
    try {
      const project = useStore.getState().serializeProject();
      const datasetIds = new Set(project.charts.flatMap((item) => item.series.map((series) => series.datasetId)));
      project.datasets = project.datasets.filter((item) => datasetIds.has(item.id));
      const title = project.charts.find((item) => item.id === project.activeChartId)?.title.trim() || t('files.figureName');
      const path = await folder.saveProject(JSON.stringify(project), title, commonSourceDirectory(figureSources, root));
      if (path && currentRoot.current === root) {
        setSearch('');
        expandTo(path);
        setSavedPath(path);
      }
    } catch {
      setError(t('files.saveError'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="section-title">{t('files.title')}</div>
      {folder ? (
        <>
          <div className="flex gap-1.5 px-3 pb-2 shrink-0">
            <button className="btn-primary flex-1" onClick={() => void changeFolder(true)}>
              {t(snapshot.root ? 'files.change' : 'files.choose')}
            </button>
            {snapshot.root && <button className="btn" onClick={() => void changeFolder(false)}>{t('files.refresh')}</button>}
          </div>
          {snapshot.root ? (
            <>
              <div className="px-3 text-[11px] truncate" title={snapshot.root}>{snapshot.root}</div>
              <div className="px-3 py-2 shrink-0">
                <input className="input" aria-label={t('files.search')} placeholder={t('files.search')}
                  value={search} onChange={(event) => setSearch(event.target.value)} />
              </div>
              <div className="px-3 text-[11px] text-(--text-2)" aria-live="polite">
                {t('files.count', { count: files.length })}
                {snapshot.skipped > 0 && <div>{t('files.skipped', { count: snapshot.skipped })}</div>}
              </div>
            </>
          ) : <p className="px-3 text-[11px]">{t('files.hint')}</p>}
        </>
      ) : <p className="px-3 text-[11px]">{t('files.desktop')}</p>}
      {hasEntries && (
        <nav aria-label={t('files.title')} className="mx-3 mb-2 min-h-8 max-h-[38%] overflow-auto">
          <WorkspaceTree node={tree} expanded={expanded} searching={!!query} activeFile={activeFile}
            activeChart={selected === 'chart' ? chart?.id : undefined} loading={loading}
            toggle={(id, open) => {
              setExpanded((current) => {
                const next = new Set(current);
                if (open) next.delete(id);
                else next.add(id);
                return next;
              });
            }}
            onFile={(file) => void openFile(file)} onChart={selectChart} />
        </nav>
      )}
      {snapshot.root && !hasEntries && <p className="px-3 pb-1 text-[11px]">{t('files.empty')}</p>}
      {figureSources.length > 0 && (
        <div className="px-3 pb-2 shrink-0">
          <div className="flex gap-1.5">
            {folder && snapshot.root && (
              <button className="btn flex-1" disabled={saving} onClick={() => void saveFigure()}>{t('files.saveFigure')}</button>
            )}
            <button className="btn flex-1 disabled:opacity-50" disabled={mergeChoices.length < 2}
              title={mergeChoices.length < 2 ? t('files.mergeNeed') : undefined}
              aria-expanded={merging} onClick={() => setMerging(!merging)}>{t('files.merge')}</button>
          </div>
          {merging && mergeChoices.length >= 2 && (
            <div className="mt-1.5 rounded border border-(--border) p-1.5">
              <ul className="max-h-28 space-y-0.5 overflow-y-auto">
                {mergeChoices.map(({ id, label }) => (
                  <li key={id}>
                    <label className="flex cursor-pointer items-center gap-1.5 px-1 py-0.5 text-[11px]" title={label}>
                      <input type="checkbox" checked={mergeIds.has(id)} onChange={(event) => {
                        const checked = event.target.checked;
                        setMergeIds((current) => {
                          const next = new Set(current);
                          if (checked) next.add(id);
                          else next.delete(id);
                          return next;
                        });
                      }} />
                      <span className="truncate">{label}</span>
                    </label>
                  </li>
                ))}
              </ul>
              <button className="btn-primary mt-1 w-full disabled:opacity-50"
                disabled={mergeChoices.filter(({ id }) => mergeIds.has(id)).length < 2} onClick={mergeSelected}>
                {t('files.mergeConfirm')}
              </button>
            </div>
          )}
          {savedPath && <p className="mt-1 truncate text-[11px] text-(--text-2)" role="status" title={savedPath}>
            {t('files.saved', { path: savedPath })}
          </p>}
        </div>
      )}
      {(error || snapshot.error) && (
        <p role="alert" title={snapshot.error} className="px-3 pb-2 text-[11px] text-red-500">
          {error || t('files.folderError')}
        </p>
      )}
      {activeSources && (
        <section className="mx-3 mb-2 max-h-32 shrink-0 overflow-auto rounded border border-(--border) p-2 text-[11px]">
          <h2 className="pb-1 font-semibold">{t('files.sources')}</h2>
          <SourceList sources={activeSources} root={snapshot.root} files={fileIds} onSource={selectSource} />
        </section>
      )}
      {selected && selected !== 'chart' && (
        <section className="mx-3 mb-2 flex min-h-0 flex-col rounded border border-(--border) p-2 text-[11px]">
          <h2 className="truncate pb-1 font-semibold" title={selected.file.id}>{selected.file.name}</h2>
          <div className="max-h-52 overflow-auto">
            {selected.project.charts.map((item, index) => (
              <div key={item.id ?? index} className="pb-1">
                <h3 className="font-medium">{chartLabel(item, index, (panel) => t('files.untitledChart', { panel }))}</h3>
                <SourceList sources={chartSources(item, selected.project.datasets)} root={snapshot.root} files={fileIds} />
              </div>
            ))}
          </div>
          <button className="btn mt-1 shrink-0" onClick={() => {
            useStore.getState().loadProject(selected.project);
            setSelected('chart');
          }}>{t('files.openFigure')}</button>
        </section>
      )}
      {opened && !filePresent && <p className="px-3 pb-2 text-[11px]">{t('files.missing')}</p>}
      {currentFile && filePresent && (!loading || loading === currentFile.file.id) && (
        <div className="px-3 pb-2 space-y-1 shrink-0">
          {currentFile.tables.length > 1 && (
            <select className="input" aria-label={t('files.sheet')} value={currentFile.sheet}
              onChange={(event) => selectSheet(currentFile, Number(event.target.value))}>
              {currentFile.tables.map(({ name, sheet }, index) => <option key={index} value={index}>{sheet ?? name}</option>)}
            </select>
          )}
          {currentFile.tables[currentFile.sheet]?.skippedPreambleRows !== undefined && (
            <p role="status" className="text-[11px] text-(--text-2)">
              {t('data.skippedPreamble', { count: currentFile.tables[currentFile.sheet].skippedPreambleRows })}
            </p>
          )}
          <div className="flex items-center gap-1.5">
            {!currentFile.tables[currentFile.sheet]?.fixedHeader && (
              <label className="flex flex-1 items-center gap-1 text-[11px]">
                <input type="checkbox" checked={currentFile.header}
                  onChange={(event) => void openFile(currentFile.file, { reload: true, header: event.target.checked })} />
                {t('data.firstRowHeader')}
              </label>
            )}
            <button className="btn !py-0.5" onClick={() => void openFile(currentFile.file, { reload: true })}>
              {t('files.reloadData')}
            </button>
          </div>
        </div>
      )}
      {dataset && showDataset && (
        <>
          <RowFilterEditor key={'filter:' + dataset.id} dataset={dataset} count={rowIndices.length} />
          <DataTable key={'table:' + dataset.id} dataset={dataset} rowIndices={rowIndices} />
        </>
      )}
    </div>
  );
}
