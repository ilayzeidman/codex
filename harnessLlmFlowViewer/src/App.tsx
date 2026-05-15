import { useState } from 'react';
import { Session } from './types';
import { FolderPicker } from './components/FolderPicker';
import { SessionHeader } from './components/SessionHeader';
import { RequestList, View } from './components/RequestList';
import { Overview } from './components/Overview';
import { RequestDetail } from './components/RequestDetail';
import { Conversation } from './components/Conversation';
import { Insights } from './components/Insights';
import { RawEventLog } from './components/RawEventLog';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [view, setView] = useState<View>({ kind: 'conversation' });

  if (!session) {
    return <FolderPicker onLoaded={setSession} />;
  }

  let main: React.ReactNode = null;
  if (view.kind === 'overview') {
    main = (
      <Overview
        session={session}
        onJumpToRequest={i => setView({ kind: 'request', index: i })}
        onJumpToInsights={() => setView({ kind: 'insights' })}
      />
    );
  } else if (view.kind === 'request') {
    const request = session.requests.find(r => r.index === view.index);
    main = request ? (
      <RequestDetail request={request} manifestStartedAtMs={session.manifest.started_at_unix_ms} />
    ) : (
      <div className="p-6 text-accent-err">Request {view.index} not found.</div>
    );
  } else if (view.kind === 'conversation') {
    main = (
      <Conversation
        session={session}
        onJumpToInsights={() => setView({ kind: 'insights' })}
      />
    );
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
          setView({ kind: 'conversation' });
        }}
      />
      <div className="flex-1 grid grid-cols-[16rem_1fr] min-h-0">
        <RequestList session={session} view={view} onSelect={setView} />
        <main className="min-h-0 overflow-y-auto">{main}</main>
      </div>
    </div>
  );
}
