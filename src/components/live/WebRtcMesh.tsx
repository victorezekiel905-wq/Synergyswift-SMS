"use client";
import { useEffect, useMemo, useRef, useState } from "react";

type Room = { id: string; host_user_id: string; state: string; created_at: string; kind?: string; name?: string | null; closes_at?: string | null };
type BreakoutRoom = Room & { members: { user_id: string; name: string }[] };
type Breakouts = { host: boolean; notice: string | null; mine: Room | null; rooms: BreakoutRoom[] };
type Peer = {
  id: string;
  room_id: string;
  user_id: string;
  display_name: string | null;
  role: string;
  state: string;
  media?: { audio?: boolean; video?: boolean } | null;
  joined_at: string;
  last_seen_at: string;
};
type Signal = {
  id: string;
  from_peer_id: string;
  to_peer_id: string;
  kind: "offer" | "answer" | "ice" | "bye";
  payload: {
    description?: RTCSessionDescriptionInit;
    candidate?: RTCIceCandidateInit;
  };
  created_at: string;
};

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

export default function WebRtcMesh(props: {
  sessionId: string;
  roleLabel: "teacher" | "student";
  canHost: boolean;
  backHref: string;
  backLabel: string;
}) {
  const [room, setRoom] = useState<Room | null>(null);
  const [peer, setPeer] = useState<Peer | null>(null);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mediaReady, setMediaReady] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  // Breakout rooms: the class's main room, and the rooms split off from it.
  const [mainRoom, setMainRoom] = useState<Room | null>(null);
  const [breakouts, setBreakouts] = useState<Breakouts | null>(null);
  const [boCount, setBoCount] = useState(3);
  const [boMinutes, setBoMinutes] = useState(10);
  const [noticeText, setNoticeText] = useState("");
  const switchingRef = useRef(false);
  // Audio only saves data on slow connections; on by default in lite mode.
  const [audioOnly, setAudioOnly] = useState(false);
  useEffect(() => { try { if (localStorage.getItem("ecf-lite") === "1") setAudioOnly(true); } catch { /* storage unavailable */ } }, []);
  const localStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const pcsRef = useRef<Record<string, RTCPeerConnection>>({});
  const peersRef = useRef<Peer[]>([]);
  const pollingRef = useRef<number | null>(null);

  useEffect(() => {
    peersRef.current = peers;
  }, [peers]);

  useEffect(() => {
    localStreamRef.current = localStream;
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = localStream;
      localVideoRef.current.muted = true;
      localVideoRef.current.play().catch(() => {});
    }
  }, [localStream]);

  useEffect(() => {
    return () => {
      if (pollingRef.current) window.clearInterval(pollingRef.current);
      void leaveRoom();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!room?.id || !peer?.id) return;
    pollOnce();
    pollingRef.current = window.setInterval(() => {
      void pollOnce();
    }, 2000);
    return () => {
      if (pollingRef.current) window.clearInterval(pollingRef.current);
      pollingRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.id, peer?.id]);

  useEffect(() => {
    if (!mainRoom?.id || !peer?.id) return;
    let stop = false;
    const tick = async () => {
      try {
        const b = await getJson<Breakouts>(`/api/webrtc/breakouts?room_id=${mainRoom.id}`);
        if (stop) return;
        setBreakouts(b);
        if (b.host || switchingRef.current) return;
        const target = b.mine ?? mainRoom;
        if (room && target.id !== room.id) await switchRoom(target);
      } catch { /* the next check tries again */ }
    };
    void tick();
    const t = window.setInterval(tick, 4000);
    return () => { stop = true; window.clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainRoom?.id, peer?.id, room?.id]);

  // Always call the latest startOffer, which reads current room and stream state.
  const startOfferRef = useRef(startOffer);
  useEffect(() => { startOfferRef.current = startOffer; });

  useEffect(() => {
    if (!peer?.id) return;
    const others = peers.filter((p) => p.id !== peer.id);
    const livePeerIds = new Set(others.map((p) => p.id));

    for (const remote of others) {
      if (!pcsRef.current[remote.id] && peer.id < remote.id && localStreamRef.current) {
        void startOfferRef.current(remote.id);
      }
    }

    for (const remoteId of Object.keys(pcsRef.current)) {
      if (!livePeerIds.has(remoteId)) {
        closePeer(remoteId);
      }
    }
  }, [peers, peer]);

  const remoteTiles = useMemo(() => Object.entries(remoteStreams), [remoteStreams]);

  async function ensureMedia() {
    if (localStreamRef.current) return localStreamRef.current;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: !audioOnly });
    if (audioOnly) setCamOn(false);
    setLocalStream(stream);
    setMediaReady(true);
    return stream;
  }

  async function joinRoom() {
    setBusy(true);
    setError(null);
    try {
      const stream = await ensureMedia();
      const rooms = await getJson<Room[]>(`/api/webrtc/rooms?session_id=${props.sessionId}`);
      let openRoom = rooms.find((r) => r.state === "open") ?? null;
      if (!openRoom && props.canHost) {
        openRoom = await sendJson<Room>("/api/webrtc/rooms", "POST", { session_id: props.sessionId });
      }
      if (!openRoom) throw new Error("No audio/video room is open yet. Ask the teacher to open one first.");

      const joinedPeer = await sendJson<Peer>("/api/webrtc/peers", "POST", {
        room_id: openRoom.id,
        role: props.roleLabel,
        media: { audio: micOn, video: camOn }
      });

      stream.getAudioTracks().forEach((track) => { track.enabled = micOn; });
      stream.getVideoTracks().forEach((track) => { track.enabled = camOn; });
      setRoom(openRoom);
      setMainRoom(openRoom);
      setPeer(joinedPeer);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function hostRoom() {
    setBusy(true);
    setError(null);
    try {
      await ensureMedia();
      const openRoom = await sendJson<Room>("/api/webrtc/rooms", "POST", { session_id: props.sessionId });
      const joinedPeer = await sendJson<Peer>("/api/webrtc/peers", "POST", {
        room_id: openRoom.id,
        role: props.roleLabel,
        media: { audio: micOn, video: camOn }
      });
      setRoom(openRoom);
      setMainRoom(openRoom);
      setPeer(joinedPeer);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** Leaves the current room (keeping camera and microphone) and joins another. */
  async function switchRoom(target: Room) {
    if (switchingRef.current) return;
    switchingRef.current = true;
    try {
      const oldPeer = peer, oldRoom = room;
      for (const remote of peersRef.current) {
        if (oldPeer && oldRoom && remote.id !== oldPeer.id) {
          await sendJson("/api/webrtc/signals", "POST", { room_id: oldRoom.id, to_peer_id: remote.id, kind: "bye", payload: {} }).catch(() => {});
        }
      }
      if (oldPeer) await sendJson("/api/webrtc/peers", "DELETE", { peer_id: oldPeer.id }).catch(() => {});
      for (const remoteId of Object.keys(pcsRef.current)) closePeer(remoteId);
      setPeers([]);
      const joined = await sendJson<Peer>("/api/webrtc/peers", "POST", { room_id: target.id, role: props.roleLabel, media: { audio: micOn, video: camOn } });
      setRoom(target);
      setPeer(joined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      switchingRef.current = false;
    }
  }

  async function breakoutAction(body: Record<string, unknown>) {
    if (!mainRoom) return;
    try {
      await sendJson("/api/webrtc/breakouts", "POST", { ...body, room_id: mainRoom.id });
      setBreakouts(await getJson<Breakouts>(`/api/webrtc/breakouts?room_id=${mainRoom.id}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function pollOnce() {
    if (!room?.id || !peer?.id) return;
    try {
      const [peerList, signals] = await Promise.all([
        getJson<Peer[]>(`/api/webrtc/peers?room_id=${room.id}`),
        getJson<Signal[]>(`/api/webrtc/signals?room_id=${room.id}&peer_id=${peer.id}`),
        sendJson<Peer>("/api/webrtc/peers", "PATCH", {
          peer_id: peer.id,
          media: { audio: micOn, video: camOn }
        })
      ]);
      setPeers(peerList);
      if (signals.length) {
        for (const signal of signals) await applySignal(signal);
        await sendJson("/api/webrtc/signals", "PATCH", {
          peer_id: peer.id,
          signal_ids: signals.map((s) => s.id)
        });
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function ensurePeerConnection(remotePeerId: string) {
    if (pcsRef.current[remotePeerId]) return pcsRef.current[remotePeerId];
    const pc = new RTCPeerConnection(RTC_CONFIG);
    pcsRef.current[remotePeerId] = pc;

    const stream = localStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));
    }

    pc.onicecandidate = (event) => {
      if (event.candidate && room?.id) {
        void sendJson("/api/webrtc/signals", "POST", {
          room_id: room.id,
          to_peer_id: remotePeerId,
          kind: "ice",
          payload: { candidate: event.candidate.toJSON() }
        }).catch(() => {});
      }
    };

    pc.ontrack = (event) => {
      const [streamObj] = event.streams;
      if (!streamObj) return;
      setRemoteStreams((prev) => ({ ...prev, [remotePeerId]: streamObj }));
    };

    pc.onconnectionstatechange = () => {
      if (["failed", "closed", "disconnected"].includes(pc.connectionState)) {
        closePeer(remotePeerId);
      }
    };

    return pc;
  }

  async function startOffer(remotePeerId: string) {
    const pc = ensurePeerConnection(remotePeerId);
    if (pc.signalingState !== "stable") return;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await sendJson("/api/webrtc/signals", "POST", {
      room_id: room?.id,
      to_peer_id: remotePeerId,
      kind: "offer",
      payload: { description: pc.localDescription }
    });
  }

  async function applySignal(signal: Signal) {
    const pc = ensurePeerConnection(signal.from_peer_id);

    if (signal.kind === "offer" && signal.payload.description) {
      if (pc.signalingState !== "stable") return;
      await pc.setRemoteDescription(new RTCSessionDescription(signal.payload.description));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await sendJson("/api/webrtc/signals", "POST", {
        room_id: room?.id,
        to_peer_id: signal.from_peer_id,
        kind: "answer",
        payload: { description: pc.localDescription }
      });
      return;
    }

    if (signal.kind === "answer" && signal.payload.description) {
      if (pc.signalingState !== "have-local-offer") return;
      await pc.setRemoteDescription(new RTCSessionDescription(signal.payload.description));
      return;
    }

    if (signal.kind === "ice" && signal.payload.candidate) {
      await pc.addIceCandidate(new RTCIceCandidate(signal.payload.candidate)).catch(() => {});
      return;
    }

    if (signal.kind === "bye") {
      closePeer(signal.from_peer_id);
    }
  }

  async function toggleMic() {
    const next = !micOn;
    setMicOn(next);
    localStreamRef.current?.getAudioTracks().forEach((track) => { track.enabled = next; });
    if (peer?.id) {
      await sendJson("/api/webrtc/peers", "PATCH", { peer_id: peer.id, media: { audio: next, video: camOn } }).catch(() => {});
    }
  }

  async function toggleCam() {
    const next = !camOn;
    setCamOn(next);
    localStreamRef.current?.getVideoTracks().forEach((track) => { track.enabled = next; });
    if (peer?.id) {
      await sendJson("/api/webrtc/peers", "PATCH", { peer_id: peer.id, media: { audio: micOn, video: next } }).catch(() => {});
    }
  }

  async function closeHostedRoom() {
    if (!room?.id || !props.canHost) return;
    await sendJson("/api/webrtc/rooms", "DELETE", { room_id: room.id }).catch(() => {});
    await leaveRoom();
    setRoom(null);
    setPeer(null);
    setPeers([]);
  }

  async function leaveRoom() {
    const currentPeerId = peer?.id;
    const currentRoomId = room?.id;
    for (const remote of peersRef.current) {
      if (remote.id !== currentPeerId && currentRoomId) {
        await sendJson("/api/webrtc/signals", "POST", {
          room_id: currentRoomId,
          to_peer_id: remote.id,
          kind: "bye",
          payload: {}
        }).catch(() => {});
      }
    }
    if (currentPeerId) {
      await sendJson("/api/webrtc/peers", "DELETE", { peer_id: currentPeerId }).catch(() => {});
    }
    for (const remoteId of Object.keys(pcsRef.current)) closePeer(remoteId);
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    setLocalStream(null);
    setMediaReady(false);
    setRemoteStreams({});
    setPeer(null);
    setPeers([]);
    setRoom(null);
    setMainRoom(null);
    setBreakouts(null);
  }

  function closePeer(remotePeerId: string) {
    const pc = pcsRef.current[remotePeerId];
    if (pc) {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.close();
      delete pcsRef.current[remotePeerId];
    }
    setRemoteStreams((prev) => {
      const next = { ...prev };
      delete next[remotePeerId];
      return next;
    });
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-medium text-brand-600">Fusion Live Audio / Video</p>
          <h1 className="text-[26px] font-serif font-semibold tracking-[-0.01em]">Realtime class room</h1>
          <p className="mt-1 text-sm text-slate-600">Talk with your class by sound and video. The teacher can split the class into breakout rooms for group work and bring everyone back.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!room && props.canHost && <button className="btn btn-primary text-xs" disabled={busy} onClick={hostRoom}>{busy ? "Opening…" : "Open room"}</button>}
          {!peer && <label className="flex items-center gap-1 text-xs text-slate-600"><input type="checkbox" checked={audioOnly} onChange={(e) => setAudioOnly(e.target.checked)} /> Audio only (uses less data)</label>}
          {!peer && <button className="btn btn-ghost text-xs" disabled={busy} onClick={joinRoom}>{busy ? "Joining…" : props.canHost ? "Join opened room" : "Join room"}</button>}
          {peer && <button className="btn btn-ghost text-xs" onClick={toggleMic}>{micOn ? "Mute mic" : "Unmute mic"}</button>}
          {peer && <button className="btn btn-ghost text-xs" onClick={toggleCam}>{camOn ? "Hide camera" : "Show camera"}</button>}
          {peer && <button className="btn btn-danger text-xs" onClick={leaveRoom}>Leave</button>}
          {peer && room && props.canHost && <button className="btn btn-ghost text-xs" onClick={closeHostedRoom}>Close room</button>}
          <a href={props.backHref} className="btn btn-ghost text-xs">{props.backLabel}</a>
        </div>
      </header>

      {error && <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>}
      {breakouts?.notice && room?.kind === "breakout" && <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">Message from the teacher: {breakouts.notice}</div>}
      {room?.kind === "breakout" && (
        <div className="mb-4 rounded-xl border border-brand-200 bg-brand-50 px-4 py-2 text-sm">
          You are in <b>{room.name}</b>{room.closes_at ? ` until ${new Date(room.closes_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}.
          {props.canHost ? "" : " You will go back to the main room when the teacher closes the rooms."}
        </div>
      )}

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.3fr,0.7fr]">
        <div className="card p-4">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Video tiles</h2>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">{peer ? `${peers.length} participant${peers.length === 1 ? "" : "s"}` : mediaReady ? "Camera ready" : "Not joined"}</span>
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-950 p-2 text-white">
              <div className="mb-2 flex items-center justify-between text-xs text-slate-300">
                <span>You</span>
                <span>{micOn ? "mic on" : "mic off"} · {camOn ? "cam on" : "cam off"}</span>
              </div>
              <video ref={localVideoRef} playsInline muted className="aspect-video w-full rounded-xl bg-slate-900 object-cover" />
            </div>
            {remoteTiles.length === 0 && (
              <div className="grid aspect-video place-items-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 text-center text-sm text-slate-400">
                <div>
                  <p>No remote participants connected yet.</p>
                  <p className="mt-1 text-xs">Keep this page open while others join.</p>
                </div>
              </div>
            )}
            {remoteTiles.map(([remotePeerId, stream]) => {
              const remotePeer = peers.find((p) => p.id === remotePeerId);
              return (
                <StreamTile
                  key={remotePeerId}
                  label={remotePeer?.display_name ?? remotePeer?.role ?? "Participant"}
                  meta={`${remotePeer?.media?.audio === false ? "mic off" : "mic on"} · ${remotePeer?.media?.video === false ? "cam off" : "cam on"}`}
                  stream={stream}
                />
              );
            })}
          </div>
        </div>

        <aside className="space-y-4">
          <div className="card p-4">
            <h2 className="text-sm font-semibold uppercase text-slate-600">Room status</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex items-center justify-between"><dt className="text-slate-500">Session</dt><dd className="font-mono text-xs">{props.sessionId}</dd></div>
              <div className="flex items-center justify-between"><dt className="text-slate-500">Room</dt><dd className="font-mono text-xs">{room?.id ?? "not opened"}</dd></div>
              <div className="flex items-center justify-between"><dt className="text-slate-500">Peer</dt><dd className="font-mono text-xs">{peer?.id ?? "not joined"}</dd></div>
            </dl>
          </div>

          {props.canHost && mainRoom && breakouts?.host && (
            <div className="card space-y-2 p-4 text-sm">
              <h2 className="text-sm font-semibold uppercase text-slate-600">Breakout rooms</h2>
              {!breakouts.rooms.length ? (
                <div className="flex flex-wrap items-end gap-2">
                  <label className="text-xs">Rooms<input type="number" min={1} max={30} className="input w-20" value={boCount} onChange={(e) => setBoCount(Number(e.target.value))} /></label>
                  <label className="text-xs">Minutes<input type="number" min={0} max={180} className="input w-20" value={boMinutes} onChange={(e) => setBoMinutes(Number(e.target.value))} /></label>
                  <button className="btn btn-primary text-xs" onClick={() => breakoutAction({ action: "open", count: boCount, minutes: boMinutes || null })}>Open rooms</button>
                  <p className="w-full text-xs text-slate-500">Students in the room now are shared out at random. You can move anyone afterwards. Set minutes to 0 for no time limit.</p>
                </div>
              ) : (
                <>
                  <ul className="space-y-2">{breakouts.rooms.map((r) => (
                    <li key={r.id} className="rounded-xl border border-slate-200 p-2">
                      <div className="flex items-center justify-between"><b>{r.name}</b>
                        {room?.id === r.id ? <span className="text-xs text-brand-700">You are here</span> : <button className="text-xs text-brand-700" onClick={() => switchRoom(r)}>Visit</button>}</div>
                      <ul className="mt-1 space-y-1 text-xs">
                        {r.members.map((m) => (
                          <li key={m.user_id} className="flex items-center justify-between gap-2"><span>{m.name}</span>
                            <select className="input w-auto py-0 text-xs" value={r.id} onChange={(e) => breakoutAction({ action: "move", user_id: m.user_id, to: e.target.value || null })} aria-label={`Move ${m.name}`}>
                              {breakouts.rooms.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}<option value="">Main room</option>
                            </select></li>
                        ))}
                        {!r.members.length && <li className="text-slate-400">Empty</li>}
                      </ul>
                    </li>
                  ))}</ul>
                  {room?.id === mainRoom.id && peers.filter((p) => p.role === "student" && !breakouts.rooms.some((r) => r.members.some((m) => m.user_id === p.user_id))).map((p) => (
                    <div key={p.id} className="flex items-center justify-between gap-2 text-xs"><span>{p.display_name} (main room)</span>
                      <select className="input w-auto py-0 text-xs" value="" onChange={(e) => e.target.value && breakoutAction({ action: "move", user_id: p.user_id, to: e.target.value })} aria-label={`Move ${p.display_name}`}>
                        <option value="">Move to…</option>{breakouts.rooms.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                      </select></div>
                  ))}
                  <div className="flex gap-2">
                    <input className="input text-xs" value={noticeText} onChange={(e) => setNoticeText(e.target.value)} placeholder="Message to every room" maxLength={300} aria-label="Message to every room" />
                    <button className="btn btn-ghost text-xs" onClick={() => breakoutAction({ action: "notice", text: noticeText || null })}>Send</button>
                  </div>
                  {room?.id !== mainRoom.id && <button className="btn btn-ghost w-full text-xs" onClick={() => switchRoom(mainRoom)}>Back to the main room</button>}
                  <button className="btn btn-danger w-full text-xs" onClick={async () => { await breakoutAction({ action: "close" }); if (room?.id !== mainRoom.id) await switchRoom(mainRoom); }}>Close rooms and bring everyone back</button>
                </>
              )}
            </div>
          )}

          <div className="card p-4">
            <h2 className="text-sm font-semibold uppercase text-slate-600">Participants</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {peers.length === 0 && <li className="text-slate-400">No one is in the room yet.</li>}
              {peers.map((p) => (
                <li key={p.id} className="rounded-xl border border-slate-200 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="font-medium text-slate-900">{p.display_name ?? p.user_id.slice(0, 8)}</p>
                      <p className="text-xs text-slate-500">{p.role}</p>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase ${p.id === peer?.id ? "bg-brand-100 text-brand-700" : "bg-slate-100 text-slate-600"}`}>{p.id === peer?.id ? "You" : "Live"}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">{p.media?.audio === false ? "Mic off" : "Mic on"} · {p.media?.video === false ? "Cam off" : "Cam on"}</p>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </section>
    </main>
  );
}

function StreamTile(props: { label: string; meta: string; stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    ref.current.srcObject = props.stream;
    ref.current.play().catch(() => {});
  }, [props.stream]);

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-950 p-2 text-white">
      <div className="mb-2 flex items-center justify-between text-xs text-slate-300">
        <span>{props.label}</span>
        <span>{props.meta}</span>
      </div>
      <video ref={ref} playsInline className="aspect-video w-full rounded-xl bg-slate-900 object-cover" />
    </div>
  );
}

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? "request failed");
  return j as T;
}

async function sendJson<T = Record<string, unknown>>(url: string, method: string, body: Record<string, unknown>): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error ?? "request failed");
  return j as T;
}
