import './App.css';

function App() {
  return (
    <div className="popup-container">
      <div className="header">
        <svg className="x-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"></path>
        </svg>
        <h1>site-enhancer</h1>
      </div>

      <div className="content">
        <p className="description">
          Quick copy buttons for X.com, Twitter, and linux.do
        </p>

        <div className="platforms">
          <div className="platform-section">
            <h2>X / Twitter</h2>
            <div className="features">
              <div className="feature-item">
                <div className="feature-icon">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"></path>
                  </svg>
                </div>
                <div className="feature-text">
                  <h3>Copy with Link</h3>
                  <p>Tweet + URL + #X</p>
                </div>
              </div>

              <div className="feature-item">
                <div className="feature-icon">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"></path>
                  </svg>
                </div>
                <div className="feature-text">
                  <h3>Copy Text Only</h3>
                  <p>Just the tweet text</p>
                </div>
              </div>
            </div>
          </div>

          <div className="platform-section">
            <h2>linux.do</h2>
            <div className="features">
              <div className="feature-item">
                <div className="feature-icon linux-icon">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"></path>
                  </svg>
                </div>
                <div className="feature-text">
                  <h3>Copy with Link</h3>
                  <p>Post + URL + #Linuxdo</p>
                </div>
              </div>

              <div className="feature-item">
                <div className="feature-icon linux-icon">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"></path>
                  </svg>
                </div>
                <div className="feature-text">
                  <h3>Copy Text Only</h3>
                  <p>Just the post text</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="usage">
          <h2>How to Use</h2>
          <ol>
            <li>Visit <strong>x.com</strong>, <strong>twitter.com</strong>, or <strong>linux.do</strong></li>
            <li>On X / Twitter, open the post’s More (⋯) menu; on linux.do, use the buttons below the post</li>
            <li>Choose Copy with Link or Copy Text Only</li>
            <li>A toast notification will confirm success</li>
          </ol>
        </div>

        <div className="footer">
          <p>Made with ❤️ for better content sharing</p>
        </div>
      </div>
    </div>
  );
}

export default App;
