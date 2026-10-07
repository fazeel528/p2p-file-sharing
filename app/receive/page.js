"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { io } from "socket.io-client";

export default function ReceivePage() {
  const [code, setCode] = useState("");
  const [socket, setSocket] = useState(null);
  const [joined, setJoined] = useState(false);
  const router = useRouter();

  const [connectionStatus, setConnectionStatus] = useState("disconnected");

  const [transferProgress, setTransferProgress] = useState(0);

  const [transferStatus, setTransferStatus] = useState("");

  const [currentFileName, setCurrentFileName] = useState("");

  const [sessionError, setSessionError] = useState("");

  useEffect(() => {
    let peer = null;
    let pendingCandidates = [];

    let fileMetadata = null;
    let receivedChunks = [];
    let receivedBytes = 0;

    const newSocket = io("http://localhost:5000");

    newSocket.on("session-error", (message) => {
      console.log("Session error:", message);

      setJoined(false);
      setSessionError(message);
    });

    newSocket.on("connect_error", () => {
      console.log("Unable to connect to signaling server");

      setConnectionStatus("disconnected");
      setSessionError("Unable to connect to server. Please try again.");
    });

    newSocket.on("peer-disconnected", () => {
      console.log("Sender disconnected");

      if (peer) {
        peer.close();
      }

      peer = null;
      pendingCandidates = [];

      setConnectionStatus("disconnected");
      setTransferStatus("peer-disconnected");
      setTransferProgress(0);
    });

    newSocket.on("connect", () => {
      console.log("Connected to signaling server");

      setConnectionStatus("connected-to-server");
    });

    newSocket.on("webrtc-offer", async ({ code: sessionCode, offer }) => {
      try {
        console.log("Offer received");

        setConnectionStatus("sender-connected");

        if (peer) {
          peer.close();
        }

        peer = new RTCPeerConnection({
          iceServers: [
            {
              urls: "stun:stun.l.google.com:19302",
            },
          ],
        });

        pendingCandidates = [];

        peer.ondatachannel = (event) => {
          const channel = event.channel;

          console.log("DataChannel received:", channel.label);

          channel.binaryType = "arraybuffer";

          channel.onopen = () => {
            console.log("DataChannel opened");

            setConnectionStatus("ready");
          };

          channel.onmessage = (event) => {
            if (typeof event.data === "string") {
              let message;

              try {
                message = JSON.parse(event.data);
              } catch (error) {
                console.log("Invalid text message:", error);

                return;
              }

              if (message.type === "file-metadata") {
                console.log("New file transfer started");

                console.log("Name:", message.name);

                console.log("Size:", message.size);

                console.log("Type:", message.mimeType);

                fileMetadata = message;
                receivedChunks = [];
                receivedBytes = 0;

                setCurrentFileName(message.name);

                setTransferProgress(0);
                setTransferStatus("receiving");

                return;
              }

              if (message.type === "file-cancelled") {
                console.log("File transfer cancelled by sender");

                console.log("Cancelled file:", fileMetadata?.name);

                fileMetadata = null;
                receivedChunks = [];
                receivedBytes = 0;

                setTransferProgress(0);
                setTransferStatus("cancelled");

                return;
              }

              if (message.type === "all-files-completed") {
                console.log("All files received successfully");

                setTransferProgress(100);
                setTransferStatus("all-completed");

                return;
              }

              return;
            }

            if (event.data instanceof ArrayBuffer) {
              if (!fileMetadata) {
                console.log("Received chunk without file metadata");

                return;
              }

              receivedChunks.push(event.data);

              receivedBytes += event.data.byteLength;

              const progress = Math.min(
                Math.round((receivedBytes / fileMetadata.size) * 100),
                100,
              );

              setTransferProgress(progress);

              console.log(
                `Received: ${receivedBytes} / ${fileMetadata.size} bytes`,
              );

              if (receivedBytes >= fileMetadata.size) {
                console.log("File transfer completed:", fileMetadata.name);

                const blob = new Blob(receivedChunks, {
                  type: fileMetadata.mimeType || "application/octet-stream",
                });

                const downloadUrl = URL.createObjectURL(blob);

                const link = document.createElement("a");

                link.href = downloadUrl;
                link.download = fileMetadata.name;

                document.body.appendChild(link);

                link.click();

                link.remove();

                URL.revokeObjectURL(downloadUrl);

                console.log("File downloaded:", fileMetadata.name);

                setTransferProgress(100);
                setTransferStatus("completed");

                if (channel.readyState === "open") {
                  channel.send(
                    JSON.stringify({
                      type: "file-received",
                      name: fileMetadata.name,
                    }),
                  );

                  console.log(
                    "File received acknowledgement sent:",
                    fileMetadata.name,
                  );
                }

                fileMetadata = null;
                receivedChunks = [];
                receivedBytes = 0;
              }
            }
          };

          channel.onclose = () => {
            console.log("DataChannel closed");

            if (peer) {
              setConnectionStatus("disconnected");
            }
          };

          channel.onerror = (error) => {
            console.log("DataChannel error:", error);
          };
        };

        peer.onconnectionstatechange = () => {
          console.log("WebRTC connection state:", peer.connectionState);

          if (peer.connectionState === "connecting") {
            setConnectionStatus("connecting");
          }

          if (peer.connectionState === "connected") {
            setConnectionStatus("p2p-connected");
          }

          if (peer.connectionState === "disconnected") {
            setConnectionStatus("disconnected");
          }

          if (peer.connectionState === "failed") {
            setConnectionStatus("failed");
            setTransferStatus("connection-failed");
          }

          if (peer.connectionState === "closed") {
            setConnectionStatus("disconnected");
          }
        };

        peer.oniceconnectionstatechange = () => {
          console.log("ICE connection state:", peer.iceConnectionState);
        };

        peer.onicecandidate = (event) => {
          if (event.candidate) {
            newSocket.emit("ice-candidate", {
              code: sessionCode,
              candidate: event.candidate,
            });
          }
        };

        await peer.setRemoteDescription(offer);

        console.log("Remote description set");

        for (const candidate of pendingCandidates) {
          try {
            await peer.addIceCandidate(candidate);
          } catch (error) {
            console.error("Error adding pending ICE candidate:", error);
          }
        }

        pendingCandidates = [];

        const answer = await peer.createAnswer();

        await peer.setLocalDescription(answer);

        console.log("Answer created");

        newSocket.emit("webrtc-answer", {
          code: sessionCode,
          answer: answer,
        });

        console.log("Answer sent to sender");
      } catch (error) {
        console.error("WebRTC offer handling error:", error);

        setConnectionStatus("failed");
      }
    });

    newSocket.on("ice-candidate", async ({ candidate }) => {
      if (!candidate) {
        console.log("Invalid ICE candidate received");

        return;
      }

      try {
        if (peer && peer.remoteDescription) {
          await peer.addIceCandidate(candidate);
        } else {
          pendingCandidates.push(candidate);
        }
      } catch (error) {
        console.error("Error adding ICE candidate:", error);
      }
    });

    setSocket(newSocket);

    return () => {
      if (peer) {
        peer.close();
      }

      newSocket.disconnect();
    };
  }, []);

  async function joinSession() {
    if (joined || !socket) {
      return;
    }

    if (!code) {
      setSessionError("Please enter an access code.");

      return;
    }

    setSessionError("");

    try {
      const response = await fetch(
        `http://localhost:5000/join-session/${code}`,
      );

      const data = await response.json();

      if (!response.ok) {
        console.log(data.error);

        setSessionError(data.error);

        return;
      }

      socket.emit("join-session", code);

      setJoined(true);

      console.log(data);
    } catch (error) {
      console.error("Error joining session:", error);

      setSessionError("Unable to connect to server.");
    }
  }

  function getStatusText() {
    if (connectionStatus === "disconnected") {
      return "Disconnected";
    }

    if (connectionStatus === "connected-to-server") {
      return "Connected to server";
    }

    if (connectionStatus === "sender-connected") {
      return "Sender connected";
    }

    if (connectionStatus === "connecting") {
      return "Connecting...";
    }

    if (connectionStatus === "p2p-connected") {
      return "P2P connection established";
    }

    if (connectionStatus === "ready") {
      return "Ready to receive";
    }

    if (connectionStatus === "failed") {
      return "Connection failed";
    }

    return "Disconnected";
  }

  function getStatusClass() {
    if (connectionStatus === "ready" || connectionStatus === "p2p-connected") {
      return "message-success";
    }

    if (connectionStatus === "failed" || connectionStatus === "disconnected") {
      return "message-error";
    }

    return "message-info";
  }

  return (
    <main className="app-container">
      <div className="app-card">
        <button className="secondary-button" onClick={() => router.push("/")}>
          ← Back to Home
        </button>

        <header className="app-header">
          <h1>Receive Files</h1>

          <p>
            Join a session and receive files directly through a peer-to-peer
            connection.
          </p>
        </header>

        <div className={`message ${getStatusClass()}`}>
          <span className="status-label">Connection status</span>

          <br />

          <span className="status-value">{getStatusText()}</span>
        </div>

        <section className="section">
          <h2 className="section-title">Join Session</h2>

          <input
            className="code-input"
            type="text"
            placeholder="Enter 6-character access code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            disabled={joined}
            maxLength={6}
          />

          <div className="button-row">
            <button
              className="primary-button"
              onClick={joinSession}
              disabled={joined || !socket || !code}
            >
              {joined ? "Joined" : "Join Session"}
            </button>
          </div>

          {joined && (
            <div className="message message-success">
              You joined the session. Waiting for the sender...
            </div>
          )}

          {sessionError && (
            <div className="message message-error">{sessionError}</div>
          )}
        </section>

        {transferStatus === "connection-failed" && (
          <div className="message message-error">
            <strong>P2P connection failed</strong>

            <p>Please reconnect to the session and try again.</p>
          </div>
        )}

        {transferStatus === "peer-disconnected" && (
          <div className="message message-error">
            <strong>Sender disconnected</strong>

            <p>The P2P connection has been closed.</p>
          </div>
        )}

        {transferStatus === "receiving" && (
          <section className="progress-section">
            <h2 className="section-title">Receiving File</h2>

            <p>File:</p>

            <p className="file-name">{currentFileName}</p>

            <p>
              Progress: <strong>{transferProgress}%</strong>
            </p>

            <progress value={transferProgress} max="100" />
          </section>
        )}

        {transferStatus === "completed" && (
          <div className="message message-success">
            <strong>File received successfully</strong>

            <p className="file-name">{currentFileName}</p>

            <p>The file has been downloaded. Waiting for the next file...</p>
          </div>
        )}

        {transferStatus === "all-completed" && (
          <div className="message message-success">
            <strong>All files received successfully</strong>

            <p>The sender has finished the transfer.</p>

            <div className="button-row">
              <button
                className="primary-button"
                onClick={() => window.location.reload()}
              >
                Join Another Session
              </button>
            </div>
          </div>
        )}

        {transferStatus === "cancelled" && (
          <div className="message message-info">
            <strong>File transfer cancelled</strong>

            <p>
              The sender cancelled the current file. Waiting for the next
              file...
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
