"use client";

import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();

  return (
    <main className="home-container">
      <div className="home-content">

        <div className="home-badge">
          P2P FILE SHARING
        </div>

        <h1 className="home-title">
          Share Files
          <span> Directly.</span>
        </h1>

        <p className="home-description">
          Fast and simple peer-to-peer file sharing.
          Send files directly between devices without
          storing your files on the server.
        </p>

        <div className="home-actions">
          <button
            className="home-button home-button-primary"
            onClick={() => router.push("/send")}
          >
            <span className="button-icon">↑</span>
            Send Files
          </button>

          <button
            className="home-button home-button-secondary"
            onClick={() => router.push("/receive")}
          >
            <span className="button-icon">↓</span>
            Receive Files
          </button>
        </div>

        <div className="home-features">
          <div className="feature-card">
            {/* <div className="feature-icon">⚡</div> */}
            <h3>Direct Transfer</h3>
            <p>
              Files are transferred directly
              between connected devices.
            </p>
          </div>

          <div className="feature-card">
            {/* <div className="feature-icon">🔒</div> */}
            <h3>No File Storage</h3>
            <p>
              Your files are not stored on
              the signaling server.
            </p>
          </div>

          <div className="feature-card">
            {/* <div className="feature-icon">👥</div> */}
            <h3>Multiple Receivers</h3>
            <p>
              Share files with multiple
              connected receivers.
            </p>
          </div>

          <div className="feature-card">
            {/* <div className="feature-icon">📁</div> */}
            <h3>250 MB Limit</h3>
            <p>
              Send files up to 250 MB each.
            </p>
          </div>
        </div>

        <p className="home-footer">
          Simple • Direct • Peer-to-Peer
        </p>

      </div>
    </main>
  );
}