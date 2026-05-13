import { useState } from 'react';
import { Session } from './types';
import { FolderPicker } from './components/FolderPicker';
import { SessionHeader } from './components/SessionHeader';
import { TurnList, View } from './components/TurnList';
import { Overview } from './components/Overview';
import { TurnDetail } from './components/TurnDetail';
import { Conversation } from './components/Conversation';
import { Insights } from './components/Insights';
import { RawEventLog } from './components/RawEventLog';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [view, setView] = useState<View>({ kind: 'overview' });

  if (!session) {
    return <FolderPicker onLoaded={setSession} />;
  }

  let main: React.ReactNode = null;
  if (view.kind === 'overview') {
    main = (
      <Overview
        session={session}
        onJumpToTurn={i => setView({ kind: 'turn', index: i })}
      />
    );
  } else if (view.kind === 'turn') {
    const turn = session.turns.find(t => t.index === view.index);
    main = turn ? (
      <TurnDetail turn={turn} manifestStartedAtMs={session.manifest.started_at_unix_ms} />
    ) : (
      <div className="p-6 text-accent-err">Turn {view.index} not found.</div>
    );
  } else if (view.kind === 'conversation') {
    main = <Conversation session={session} />;
  } else if (view.kind === 'insights') {
    main = <Insights session={session} />;
  } else if (view.kind === 'raw') {
    main = <RawEventLog session={session} />;
  }

  return (
    <div className="h-full flex flex-col">
      <SessionHeader
        session={session}
        onReset={() => {
          setSession(null);
          setView({ kind: 'overview' });
        }}
      />
      <div className="flex-1 grid grid-cols-[16rem_1fr] min-h-0">
        <TurnList session={session} view={view} onSelect={setView} />
        <main className="min-h-0 overflow-y-auto">{main}</main>
      </div>
    </div>
  );
}
