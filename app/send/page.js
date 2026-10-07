"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { io } from "socket.io-client";

const MAX_FILE_SIZE = 250 * 1024 * 1024;

export default function SendPage() {
  const [code, setCode] = useState("");
  const [socket, setSocket] = useState(null);
  const router = useRouter();

  const [selectedFiles, setSelectedFiles] = useState([]);
  const [channelReady, setChannelReady] = useState(false);

  const [connectionStatus, setConnectionStatus] = useState("disconnected");

  const [transferProgress, setTransferProgress] = useState(0);
  const [transferSpeed, setTransferSpeed] = useState(0);

  const [isTransferring, setIsTransferring] = useState(false);
  const [transferStatus, setTransferStatus] = useState("");

  const [currentFileIndex, setCurrentFileIndex] = useState(0);

  const peersRef = useRef(new Map());
  const channelsRef = useRef(new Map());

  const selectedFilesRef = useRef([]);
  const isSendingRef = useRef(false);
  const cancelCurrentRef = useRef(false);

  useEffect(() => {
    const newSocket = io("http://localhost:5000");

    const pendingCandidates = new Map();

    function updateChannelReady() {
      const hasOpenChannel = Array.from(channelsRef.current.values()).some(
        (channel) => channel.readyState === "open",
      );

      setChannelReady(hasOpenChannel);

      if (!hasOpenChannel) {
        setConnectionStatus("disconnected");
      }
    }

    newSocket.on("connect_error", () => {
      console.log("Unable to connect to signaling server");

      setConnectionStatus("disconnected");
      setTransferStatus("server-error");
    });

    newSocket.on("peer-disconnected", ({ receiverId } = {}) => {
      if (receiverId) {
        console.log("Receiver disconnected:", receiverId);

        const channel = channelsRef.current.get(receiverId);

        if (channel) {
          channel.close();
        }

        const peer = peersRef.current.get(receiverId);

        if (peer) {
          peer.close();
        }

        channelsRef.current.delete(receiverId);
        peersRef.current.delete(receiverId);
        pendingCandidates.delete(receiverId);

        updateChannelReady();

        if (channelsRef.current.size === 0) {
          setTransferStatus("peer-disconnected");
        }
      } else {
        console.log("Session sender disconnected");

        for (const channel of channelsRef.current.values()) {
          channel.close();
        }

        for (const peer of peersRef.current.values()) {
          peer.close();
        }

        channelsRef.current.clear();
        peersRef.current.clear();
        pendingCandidates.clear();

        setChannelReady(false);
        setConnectionStatus("disconnected");
        setTransferStatus("peer-disconnected");
      }
    });

    newSocket.on("connect", () => {
      console.log("Connected to signaling server");

      setConnectionStatus("connected-to-server");
    });

    newSocket.on(
      "receiver-joined",
      async ({ code: sessionCode, receiverId }) => {
        console.log("New receiver joined:", receiverId);

        setConnectionStatus("receiver-connected");

        const peer = new RTCPeerConnection({
          iceServers: [
            {
              urls: "stun:stun.l.google.com:19302",
            },
          ],
        });

        peersRef.current.set(receiverId, peer);
        pendingCandidates.set(receiverId, []);

        peer.onicecandidate = (event) => {
          if (event.candidate) {
            newSocket.emit("ice-candidate", {
              code: sessionCode,
              targetId: receiverId,
              candidate: event.candidate,
            });
          }
        };

        peer.onconnectionstatechange = () => {
          console.log(`WebRTC state for ${receiverId}:`, peer.connectionState);

          if (peer.connectionState === "connecting") {
            setConnectionStatus("connecting");
          }

          if (peer.connectionState === "connected") {
            setConnectionStatus("p2p-connected");
          }

          if (
            peer.connectionState === "failed" ||
            peer.connectionState === "closed"
          ) {
            console.log(`WebRTC connection failed for receiver ${receiverId}`);

            peersRef.current.delete(receiverId);
            channelsRef.current.delete(receiverId);
            pendingCandidates.delete(receiverId);

            updateChannelReady();

            if (channelsRef.current.size === 0) {
              setTransferStatus("connection-failed");
              setConnectionStatus("disconnected");
            }
          }
        };

        peer.oniceconnectionstatechange = () => {
          console.log(`ICE state for ${receiverId}:`, peer.iceConnectionState);
        };

        const channel = peer.createDataChannel("file-transfer");

        channelsRef.current.set(receiverId, channel);

        channel.onmessage = (event) => {
          if (typeof event.data !== "string") {
            return;
          }

          try {
            const message = JSON.parse(event.data);

            if (message.type === "file-received") {
              console.log(
                `Receiver ${receiverId} confirmed file:`,
                message.name,
              );
            }
          } catch (error) {
            console.log("Invalid message from receiver:", error);
          }
        };

        channel.onopen = () => {
          console.log(`DataChannel opened for receiver ${receiverId}`);

          updateChannelReady();
          setConnectionStatus("ready");
        };

        channel.onclose = () => {
          console.log(`DataChannel closed for receiver ${receiverId}`);

          channelsRef.current.delete(receiverId);
          updateChannelReady();
        };

        channel.onerror = (error) => {
          console.log(`DataChannel error for receiver ${receiverId}:`, error);
        };

        const offer = await peer.createOffer();

        await peer.setLocalDescription(offer);

        newSocket.emit("webrtc-offer", {
          code: sessionCode,
          receiverId: receiverId,
          offer: offer,
        });

        console.log(`Offer sent to receiver ${receiverId}`);
      },
    );

    newSocket.on("webrtc-answer", async ({ receiverId, answer }) => {
      console.log("Answer received from:", receiverId);

      const peer = peersRef.current.get(receiverId);

      if (!peer) {
        console.log("Peer connection not found:", receiverId);
        return;
      }

      await peer.setRemoteDescription(answer);

      const candidates = pendingCandidates.get(receiverId) || [];

      for (const candidate of candidates) {
        await peer.addIceCandidate(candidate);
      }

      pendingCandidates.set(receiverId, []);

      console.log(`Remote description set for ${receiverId}`);
    });

    newSocket.on("ice-candidate", async ({ receiverId, candidate }) => {
      const peer = peersRef.current.get(receiverId);

      if (!peer) {
        return;
      }

      if (peer.remoteDescription) {
        await peer.addIceCandidate(candidate);
      } else {
        const candidates = pendingCandidates.get(receiverId) || [];

        candidates.push(candidate);

        pendingCandidates.set(receiverId, candidates);
      }
    });

    setSocket(newSocket);

    return () => {
      for (const channel of channelsRef.current.values()) {
        channel.close();
      }

      for (const peer of peersRef.current.values()) {
        peer.close();
      }

      channelsRef.current.clear();
      peersRef.current.clear();

      newSocket.disconnect();
    };
  }, []);

  async function waitForBuffer(channel) {
    if (channel.bufferedAmount <= 4 * 1024 * 1024) {
      return;
    }

    channel.bufferedAmountLowThreshold = 1024 * 1024;

    await new Promise((resolve) => {
      const checkBuffer = () => {
        if (channel.bufferedAmount <= 1024 * 1024) {
          channel.removeEventListener("bufferedamountlow", checkBuffer);

          resolve();
        }
      };

      channel.addEventListener("bufferedamountlow", checkBuffer);
    });
  }

  function getOpenChannels() {
    return Array.from(channelsRef.current.entries()).filter(
      ([, channel]) => channel.readyState === "open",
    );
  }

  async function sendFile(file) {
    const channels = getOpenChannels();

    if (channels.length === 0) {
      console.log("No DataChannel is open");

      return false;
    }

    isSendingRef.current = true;
    cancelCurrentRef.current = false;

    setIsTransferring(true);
    setTransferProgress(0);
    setTransferSpeed(0);
    setTransferStatus("sending");

    const startTime = Date.now();

    const metadata = {
      type: "file-metadata",
      name: file.name,
      size: file.size,
      mimeType: file.type,
    };

    for (const [, channel] of channels) {
      if (channel.readyState === "open") {
        channel.send(JSON.stringify(metadata));
      }
    }

    console.log(`Sending ${file.name} to ${channels.length} receiver(s)`);

    const chunkSize = 64 * 1024;

    let offset = 0;

    while (offset < file.size && !cancelCurrentRef.current) {
      const chunk = file.slice(offset, offset + chunkSize);

      const buffer = await chunk.arrayBuffer();

      if (cancelCurrentRef.current) {
        break;
      }

      for (const [receiverId, channel] of channels) {
        if (channel.readyState !== "open") {
          console.log(`Receiver ${receiverId} is no longer connected`);

          continue;
        }

        await waitForBuffer(channel);

        if (cancelCurrentRef.current) {
          break;
        }

        if (channel.readyState === "open") {
          channel.send(buffer);
        }
      }

      offset += buffer.byteLength;

      const progress = Math.round((offset / file.size) * 100);

      setTransferProgress(progress);

      const elapsedSeconds = (Date.now() - startTime) / 1000;

      if (elapsedSeconds > 0) {
        const speed = offset / elapsedSeconds / (1024 * 1024);

        setTransferSpeed(speed);
      }

      console.log(`Sent: ${offset} / ${file.size} bytes`);
    }

    if (cancelCurrentRef.current) {
      for (const [, channel] of getOpenChannels()) {
        channel.send(
          JSON.stringify({
            type: "file-cancelled",
          }),
        );
      }

      console.log("File transfer cancelled:", file.name);

      isSendingRef.current = false;
      setIsTransferring(false);
      setTransferStatus("cancelled");

      return false;
    }

    console.log("All chunks sent:", file.name);

    isSendingRef.current = false;
    setIsTransferring(false);
    setTransferStatus("completed");

    return true;
  }

  function cancelCurrentFile() {
    if (!isSendingRef.current) {
      return;
    }

    cancelCurrentRef.current = true;

    console.log("Cancelling current file...");
  }

  async function sendFiles() {
    const files = selectedFilesRef.current;

    if (files.length === 0) {
      console.log("No files selected");
      return;
    }

    if (getOpenChannels().length === 0) {
      console.log("No receiver is connected");

      setTransferStatus("no-receiver");

      return;
    }

    if (isTransferring) {
      return;
    }

    console.log(`Starting transfer of ${files.length} files`);

    for (let i = 0; i < files.length; i++) {
      setCurrentFileIndex(i);

      console.log(`Sending file ${i + 1} of ${files.length}`);

      const completed = await sendFile(files[i]);

      if (!completed) {
        console.log(`Skipped cancelled file: ${files[i].name}`);
      }
    }

    const channels = getOpenChannels();

    for (const [, channel] of channels) {
      channel.send(
        JSON.stringify({
          type: "all-files-completed",
        }),
      );
    }

    setTransferStatus("all-completed");

    console.log("All selected files processed");
  }

  function handleFileSelect(event) {
    const files = Array.from(event.target.files);

    if (files.length === 0) {
      return;
    }

    const currentFiles = selectedFilesRef.current;
    const newFiles = [];

    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) {
        alert(`${file.name} is larger than the 250 MB limit.`);

        console.log(`File rejected: ${file.name}`);

        continue;
      }

      const alreadySelected = currentFiles.some(
        (existingFile) =>
          existingFile.name === file.name &&
          existingFile.size === file.size &&
          existingFile.lastModified === file.lastModified,
      );

      if (alreadySelected) {
        console.log(`File already selected: ${file.name}`);

        continue;
      }

      newFiles.push(file);

      console.log(`File selected: ${file.name}`);
    }

    const updatedFiles = [...currentFiles, ...newFiles];

    selectedFilesRef.current = updatedFiles;
    setSelectedFiles(updatedFiles);

    console.log(`Total files selected: ${updatedFiles.length}`);

    event.target.value = "";
  }

  function removeFile(index) {
    const updatedFiles = selectedFilesRef.current.filter(
      (_, fileIndex) => fileIndex !== index,
    );

    selectedFilesRef.current = updatedFiles;
    setSelectedFiles(updatedFiles);

    console.log(`Removed file at index ${index}`);
  }

  function clearAllFiles() {
    selectedFilesRef.current = [];
    setSelectedFiles([]);

    console.log("All selected files cleared");
  }

  async function generateCode() {
    const response = await fetch("http://localhost:5000/create-session");

    const data = await response.json();

    setCode(data.code);

    if (socket) {
      socket.emit("join-session", data.code);
    }
  }

  return (
    <main className="app-container">
      <div className="app-card">
        <button className="secondary-button" onClick={() => router.push("/")}>
          ← Back to Home
        </button>
        <header className="app-header">
          <h1>Send Files</h1>

          <p>
            Share files directly with connected receivers through a peer-to-peer
            connection.
          </p>
        </header>

        <div
          className={`message ${
            connectionStatus === "ready" || connectionStatus === "p2p-connected"
              ? "message-success"
              : connectionStatus === "failed" ||
                  connectionStatus === "disconnected"
                ? "message-error"
                : "message-info"
          }`}
        >
          <span className="status-label">Connection status</span>

          <br />

          <span className="status-value">
            {connectionStatus === "disconnected" && "Disconnected"}

            {connectionStatus === "connected-to-server" &&
              "Connected to server"}

            {connectionStatus === "receiver-connected" && "Receiver connected"}

            {connectionStatus === "connecting" && "Connecting..."}

            {connectionStatus === "p2p-connected" &&
              "P2P connection established"}

            {connectionStatus === "ready" && "Ready to send"}

            {connectionStatus === "failed" && "Connection failed"}
          </span>
        </div>

        <div className="receiver-count">
          Connected receivers: <strong>{channelsRef.current.size}</strong>
        </div>

        <section className="section">
          <h2 className="section-title">Create Sharing Session</h2>

          <div className="button-row">
            <button
              className="primary-button"
              onClick={generateCode}
              disabled={!!code}
            >
              {code ? "Share Code Generated" : "Generate Share Code"}
            </button>
          </div>

          {code && (
            <div className="session-code">
              <p className="session-code-label">Access Code</p>

              <p className="session-code-value">{code}</p>
            </div>
          )}
        </section>

        <section className="section">
          <h2 className="section-title">Select Files</h2>

          <input
            className="file-input"
            type="file"
            multiple
            onChange={handleFileSelect}
            disabled={isTransferring}
          />

          <p className="file-size">Maximum file size: 250 MB per file</p>
        </section>

        {selectedFiles.length > 0 && (
          <section className="section">
            <h2 className="section-title">
              Selected Files ({selectedFiles.length})
            </h2>

            <div className="file-list">
              {selectedFiles.map((file, index) => (
                <div className="file-item" key={index}>
                  <div className="file-info">
                    <p className="file-name">
                      {index + 1}. {file.name}
                    </p>

                    <p className="file-size">
                      {(file.size / (1024 * 1024)).toFixed(2)} MB
                    </p>
                  </div>

                  <button
                    className="danger-button"
                    onClick={() => removeFile(index)}
                    disabled={isTransferring}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>

            <div className="button-row">
              <button
                className="secondary-button"
                onClick={clearAllFiles}
                disabled={isTransferring}
              >
                Clear All
              </button>
            </div>
          </section>
        )}

        <section className="section">
          <button
            className="primary-button"
            onClick={sendFiles}
            disabled={
              !channelReady || selectedFiles.length === 0 || isTransferring
            }
          >
            {isTransferring ? "Sending..." : "Send Files"}
          </button>
        </section>

        {transferStatus === "sending" && (
          <section className="progress-section">
            <h2 className="section-title">Sending Files</h2>

            <p>
              File <strong>{currentFileIndex + 1}</strong> of{" "}
              <strong>{selectedFiles.length}</strong>
            </p>

            <p className="file-name">{selectedFiles[currentFileIndex]?.name}</p>

            <p>
              Progress: <strong>{transferProgress}%</strong>
            </p>

            <progress value={transferProgress} max="100" />

            <p>
              Speed: <strong>{transferSpeed.toFixed(2)} MB/s</strong>
            </p>

            <div className="button-row">
              <button className="danger-button" onClick={cancelCurrentFile}>
                Cancel Current File
              </button>
            </div>
          </section>
        )}

        {transferStatus === "server-error" && (
          <div className="message message-error">
            Unable to connect to server. Please make sure the server is running.
          </div>
        )}

        {transferStatus === "connection-failed" && (
          <div className="message message-error">
            P2P connection failed. Please ask the receiver to reconnect.
          </div>
        )}

        {transferStatus === "no-receiver" && (
          <div className="message message-info">
            No receiver is connected. Ask someone to join your session first.
          </div>
        )}

        {transferStatus === "peer-disconnected" && (
          <div className="message message-error">Receiver disconnected.</div>
        )}

        {transferStatus === "completed" && (
          <div className="message message-success">
            Current file completed successfully.
          </div>
        )}

        {transferStatus === "cancelled" && (
          <div className="message message-info">Current file cancelled.</div>
        )}

        {transferStatus === "all-completed" && (
          <div className="message message-success">
            <strong>All files processed successfully.</strong>

            <div className="button-row">
              <button
                className="primary-button"
                onClick={() => window.location.reload()}
              >
                Start New Session
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
