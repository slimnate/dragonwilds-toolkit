import { useEffect, useState } from 'react';
import { loadCatalog } from './catalog';
import { AppearanceSection } from './sections/AppearanceSection';
import { FileSection } from './sections/FileSection';
import { InventorySection } from './sections/InventorySection';
import { JournalSection } from './sections/JournalSection';
import { MapSection } from './sections/MapSection';
import { ProgressSection } from './sections/ProgressSection';
import { QuestsSection } from './sections/QuestsSection';
import { SkillsSection } from './sections/SkillsSection';
import { SpellsSection } from './sections/SpellsSection';
import { VitalsSection } from './sections/VitalsSection';
import { WorldActorsSection } from './sections/world/WorldActorsSection';
import { WorldBuildingsSection } from './sections/world/WorldBuildingsSection';
import { WorldContainersSection } from './sections/world/WorldContainersSection';
import { WorldFileSection } from './sections/world/WorldFileSection';
import { WorldProgressSection } from './sections/world/WorldProgressSection';
import { WorldResourcesSection } from './sections/world/WorldResourcesSection';
import { WorldTimeSection } from './sections/world/WorldTimeSection';
import {
  defaultSaveDir,
  defaultSavedDir,
  defaultWorldsDir,
  isTauri,
  listCharacters,
  listWorlds,
  openInExplorer,
  pickSaveAs,
  pickSaveFile,
  readCharacter,
  readWorld,
  writeCharacter,
  writeWorld,
} from './native';
import { characterName } from './saves/access';
import { parseCharacterSave, serializeUnrealJson } from './saves/serialize';
import { pruneInventoryContainers } from './saves/inventory';
import {
  isWorldBytes,
  parseWorld,
  type WorldDocument,
} from './saves/spud/world';
import type { CharacterFileInfo, JsonObject } from './saves/types';

const CHARACTER_SECTIONS = [
  { id: 'file', label: 'File' },
  { id: 'vitals', label: 'Character' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'skills', label: 'Skills' },
  { id: 'spells', label: 'Spells' },
  { id: 'map', label: 'Map' },
  { id: 'journal', label: 'Journal' },
  { id: 'quests', label: 'Quests' },
  { id: 'progress', label: 'Progress' },
  { id: 'appearance', label: 'Appearance' },
] as const;

const WORLD_SECTIONS = [
  { id: 'file', label: 'File' },
  { id: 'progress', label: 'Progress' },
  { id: 'time', label: 'Time' },
  { id: 'resources', label: 'Resources' },
  { id: 'containers', label: 'Containers' },
  { id: 'buildings', label: 'Buildings' },
  { id: 'actors', label: 'Actors' },
] as const;

type EditorMode = 'character' | 'world';

export default function App() {
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [status, setStatus] = useState('Loading catalog…');
  const [mode, setMode] = useState<EditorMode>('character');
  const [files, setFiles] = useState<CharacterFileInfo[]>([]);
  const [path, setPath] = useState<string | null>(null);
  const [save, setSave] = useState<JsonObject | null>(null);
  const [world, setWorld] = useState<WorldDocument | null>(null);
  const [dirty, setDirty] = useState(false);
  const [section, setSection] = useState('file');
  const [busy, setBusy] = useState(false);
  const [catalogReady, setCatalogReady] = useState(false);

  useEffect(() => {
    loadCatalog()
      .then(() => {
        setCatalogError(null);
        setCatalogReady(true);
        if (!isTauri()) {
          setStatus('Browser mode — open a character JSON or world .sav file.');
        } else {
          setStatus('');
        }
      })
      .catch((error: unknown) => {
        setCatalogError(error instanceof Error ? error.message : String(error));
        setStatus('Catalog failed');
      });
  }, []);

  useEffect(() => {
    if (!catalogReady || !isTauri()) return;
    let cancelled = false;
    void (async () => {
      const dir =
        mode === 'world' ? await defaultWorldsDir() : await defaultSaveDir();
      const listed =
        mode === 'world' ? await listWorlds(dir) : await listCharacters(dir);
      if (cancelled) return;
      setFiles(listed);
    })();
    return () => {
      cancelled = true;
    };
  }, [catalogReady, mode]);

  function openDocument(bytes: Uint8Array, nextPath: string) {
    if (isWorldBytes(bytes)) {
      setMode('world');
      setWorld(parseWorld(bytes));
      setSave(null);
    } else {
      setMode('character');
      setSave(parseCharacterSave(new TextDecoder().decode(bytes)));
      setWorld(null);
    }
    setPath(nextPath);
    setDirty(false);
    setSection('file');
    setStatus('');
  }

  async function openPath(nextPath: string) {
    setBusy(true);
    try {
      if (mode === 'world' || nextPath.toLowerCase().endsWith('.sav')) {
        openDocument(await readWorld(nextPath), nextPath);
      } else {
        const text = await readCharacter(nextPath);
        setSave(parseCharacterSave(text));
        setWorld(null);
        setMode('character');
        setPath(nextPath);
        setDirty(false);
        setSection('file');
        setStatus('');
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function openPicked() {
    if (!isTauri()) {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,.sav,application/json,application/octet-stream';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        openDocument(new Uint8Array(await file.arrayBuffer()), file.name);
      };
      input.click();
      return;
    }
    const picked = await pickSaveFile(await defaultSavedDir());
    if (picked) await openPath(picked);
  }

  async function saveTo(nextPath: string) {
    setBusy(true);
    try {
      if (world) {
        await writeWorld(nextPath, world.bytes, true);
      } else if (save) {
        await writeCharacter(
          nextPath,
          serializeUnrealJson(pruneInventoryContainers(save)),
          true,
        );
      } else {
        return;
      }
      setPath(nextPath);
      setDirty(false);
      setStatus(`Wrote ${nextPath}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function saveExisting() {
    if (!path) {
      await saveAs();
      return;
    }
    await saveTo(path);
  }

  async function saveAs() {
    const kind = world ? 'sav' : 'json';
    const suggested =
      path ??
      (world
        ? `${world.info.worldName || 'world'}.sav`
        : save
          ? `${characterName(save)}.json`
          : 'character.json');
    const picked = await pickSaveAs(suggested, kind);
    if (picked) await saveTo(picked);
  }

  function updateSave(next: JsonObject) {
    setSave(next);
    setDirty(true);
  }

  function updateWorld(next: WorldDocument) {
    setWorld(next);
    setDirty(true);
  }

  async function revealFolder(folder: 'characters' | 'worlds') {
    try {
      await openInExplorer(folder);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  function switchMode(next: EditorMode) {
    setMode(next);
    setSection('file');
  }

  const sections = mode === 'world' ? WORLD_SECTIONS : CHARACTER_SECTIONS;
  const openDoc = mode === 'world' ? world : save;

  return (
    <div className='app'>
      <header className='topbar'>
        <div>
          <h1>Dragonwilds Toolkit</h1>
          {path ? (
            <p className='path topbar-path'>
              {path} {dirty ? ' *' : ''}
            </p>
          ) : null}
          {status ? <p className='hint'>{status}</p> : null}
        </div>
        <div className='actions'>
          <button type='button' disabled={busy} onClick={openPicked}>
            Open…
          </button>
          <button
            type='button'
            disabled={!openDoc || busy}
            onClick={saveExisting}
          >
            Save
          </button>
          <button type='button' disabled={!openDoc || busy} onClick={saveAs}>
            Save as…
          </button>
        </div>
      </header>

      {catalogError ? <p className='error'>{catalogError}</p> : null}

      <div className='workspace'>
        <aside>
          <div className='mode-tablist' role='tablist' aria-label='Save type'>
            <button
              type='button'
              role='tab'
              className='mode-tab'
              aria-selected={mode === 'character'}
              onClick={() => switchMode('character')}
            >
              Character
            </button>
            <button
              type='button'
              role='tab'
              className='mode-tab'
              aria-selected={mode === 'world'}
              onClick={() => switchMode('world')}
            >
              World
            </button>
          </div>
          {files.length > 0 ? (
            <div className='file-list'>
              <h2>{mode === 'world' ? 'Worlds' : 'Characters'}</h2>
              {files.map((file) => (
                <button
                  key={file.path}
                  type='button'
                  className={
                    file.path === path ? 'file-btn active' : 'file-btn'
                  }
                  onClick={() => openPath(file.path)}
                >
                  {file.name.replace(/\.(json|sav)$/i, '')}
                </button>
              ))}
            </div>
          ) : null}
          {openDoc ? (
            <nav className='sections'>
              {sections.map((entry) => (
                <button
                  key={entry.id}
                  type='button'
                  className={
                    section === entry.id ? 'section-btn active' : 'section-btn'
                  }
                  onClick={() => setSection(entry.id)}
                >
                  {entry.label}
                </button>
              ))}
            </nav>
          ) : null}
        </aside>
        <main>
          {!openDoc ? (
            <section className='panel'>
              <h2>Open a {mode === 'world' ? 'world' : 'character'}</h2>
              <p>
                Open a detected {mode === 'world' ? 'world' : 'character'} file
                from the list on the left, or open a file from the filesystem
                below.
              </p>
              <p>
                <button
                  type='button'
                  onClick={() =>
                    revealFolder(mode === 'world' ? 'worlds' : 'characters')
                  }
                >
                  Open {mode === 'world' ? 'world' : 'character'} folder
                </button>
              </p>
              <p>
                {mode === 'world' ? (
                  <>
                    World slots live in{' '}
                    <code>%LocalAppData%\RSDragonwilds\Saved\SaveGames</code>.
                  </>
                ) : (
                  <>
                    Live files live in{' '}
                    <code>
                      %LocalAppData%\RSDragonwilds\Saved\SaveCharacters
                    </code>
                    .
                  </>
                )}{' '}
                You can also open a backup from the repo <code>saves/</code>{' '}
                folder.
              </p>
            </section>
          ) : mode === 'world' && world ? (
            <>
              {section === 'file' ? (
                <WorldFileSection
                  doc={world}
                  path={path}
                  onChange={updateWorld}
                />
              ) : null}
              {section === 'progress' ? (
                <WorldProgressSection doc={world} onChange={updateWorld} />
              ) : null}
              {section === 'time' ? (
                <WorldTimeSection doc={world} onChange={updateWorld} />
              ) : null}
              {section === 'resources' ? (
                <WorldResourcesSection doc={world} onChange={updateWorld} />
              ) : null}
              {section === 'containers' ? (
                <WorldContainersSection doc={world} onChange={updateWorld} />
              ) : null}
              {section === 'buildings' ? (
                <WorldBuildingsSection doc={world} onChange={updateWorld} />
              ) : null}
              {section === 'actors' ? (
                <WorldActorsSection doc={world} onChange={updateWorld} />
              ) : null}
            </>
          ) : save ? (
            <>
              {section === 'file' ? (
                <FileSection save={save} path={path} onChange={updateSave} />
              ) : null}
              {section === 'vitals' ? (
                <VitalsSection save={save} onChange={updateSave} />
              ) : null}
              {section === 'inventory' ? (
                <InventorySection save={save} onChange={updateSave} />
              ) : null}
              {section === 'skills' ? (
                <SkillsSection save={save} onChange={updateSave} />
              ) : null}
              {section === 'spells' ? (
                <SpellsSection save={save} onChange={updateSave} />
              ) : null}
              {section === 'map' ? (
                <MapSection save={save} onChange={updateSave} />
              ) : null}
              {section === 'journal' ? (
                <JournalSection save={save} onChange={updateSave} />
              ) : null}
              {section === 'quests' ? (
                <QuestsSection save={save} onChange={updateSave} />
              ) : null}
              {section === 'progress' ? (
                <ProgressSection save={save} onChange={updateSave} />
              ) : null}
              {section === 'appearance' ? (
                <AppearanceSection save={save} onChange={updateSave} />
              ) : null}
            </>
          ) : null}
        </main>
      </div>
      <p className='banner'>
        Close the game before overwriting a live save. Backups are written as{' '}
        <code>.editorbackup</code>. Single-player edits are fine; do not use
        this to cheat in shared worlds.
      </p>
    </div>
  );
}
