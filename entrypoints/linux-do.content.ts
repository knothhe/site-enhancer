import { copyToClipboard } from '../utils/clipboard';
import { getPostText, getPostUrl, linuxDoLabels } from '../utils/linux-do';

export default defineContentScript({
  matches: ['*://linux.do/*'],
  main(ctx) {
    // Inject CSS styles
    const style = document.createElement('style');
    style.textContent = `
      .linux-do-copy-btn {
        color: #6d6d6d !important;
      }
      .linux-do-copy-btn svg {
        width: 18px;
        height: 18px;
        display: block;
        fill: #6d6d6d;
      }
      .linux-do-copy-buttons-container {
        display: inline-flex;
        gap: 4px;
        margin-left: 8px;
      }
      .linux-do-tooltip {
        position: fixed;
        bottom: 80px;
        left: 50%;
        transform: translateX(-50%);
        background-color: #000;
        color: white;
        padding: 12px 24px;
        border-radius: 8px;
        font-size: 15px;
        font-weight: 600;
        z-index: 2147483647;
        opacity: 0;
        transition: opacity 0.3s;
        pointer-events: none;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      }
      .linux-do-tooltip.show {
        opacity: 1;
      }
    `;
    document.head.appendChild(style);

    // Create toast notification element
    const toast = document.createElement('div');
    toast.className = 'linux-do-tooltip';
    document.body.appendChild(toast);

    let toastTimer: ReturnType<typeof setTimeout> | undefined;
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');

    function showToast(message: string) {
      clearTimeout(toastTimer);
      toast.textContent = message;
      toast.classList.add('show');
      toastTimer = setTimeout(() => {
        toast.classList.remove('show');
      }, 2000);
    }

    // Icons for buttons
    const copyWithLinkIcon = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"></path>
      </svg>
    `;

    const copyTextOnlyIcon = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"></path>
      </svg>
    `;

    const labels = linuxDoLabels();

    function addCopyButtons(post: Element) {
      // Check if buttons already exist
      if (post.querySelector('.linux-do-copy-btn')) {
        return;
      }

      // Find the post-controls container
      const controls = post.querySelector('.post-controls');
      if (!controls) {
        return;
      }

      // Create first button (copy text only)
      const copyTextOnlyBtn = document.createElement('button');
      copyTextOnlyBtn.className = 'widget-button btn-flat linux-do-copy-btn btn';
      copyTextOnlyBtn.innerHTML = copyTextOnlyIcon;
      copyTextOnlyBtn.title = labels.text;
      copyTextOnlyBtn.type = 'button';
      copyTextOnlyBtn.setAttribute('aria-label', copyTextOnlyBtn.title);

      // Create second button (copy with link)
      const copyWithLinkBtn = document.createElement('button');
      copyWithLinkBtn.className = 'widget-button btn-flat linux-do-copy-btn btn';
      copyWithLinkBtn.innerHTML = copyWithLinkIcon;
      copyWithLinkBtn.title = labels.link;
      copyWithLinkBtn.type = 'button';
      copyWithLinkBtn.setAttribute('aria-label', copyWithLinkBtn.title);

      // Add click handlers
      copyTextOnlyBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();

        const postText = getPostText(post);

        if (postText) {
          const success = await copyToClipboard(postText);
          showToast(success ? labels.copiedText : labels.failed);
        } else {
          showToast(labels.empty);
        }
      });

      copyWithLinkBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();

        const postText = getPostText(post);
        const postUrl = getPostUrl(post);

        if (postText) {
          const copyText = `${postText}\n${postUrl}\n#Linuxdo`;
          const success = await copyToClipboard(copyText);
          showToast(success ? labels.copiedLink : labels.failed);
        } else {
          showToast(labels.empty);
        }
      });

      // Insert at the end of controls (so they appear on the right)
      controls.appendChild(copyTextOnlyBtn);
      controls.appendChild(copyWithLinkBtn);
    }

    // Function to process existing posts
    function processPosts() {
      // Try multiple selectors to find posts
      const postSelectors = [
        '.topic-post',
        'article',
        '[itemprop="articleBody"]',
        '.post'
      ];

      for (const selector of postSelectors) {
        const posts = document.querySelectorAll(selector);
        if (posts.length > 0) {
          posts.forEach(post => addCopyButtons(post));
          break;
        }
      }
    }

    // Wait for page to be ready
    function init() {
      processPosts();
    }

    if (document.readyState === 'loading') {
      ctx.addEventListener(document, 'DOMContentLoaded', init, { once: true });
    } else {
      init();
    }

    // Watch for new posts using MutationObserver
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof Element) {
            // Controls may be mounted after the post itself.
            const containingPost = node.closest('.topic-post, article, .post');
            if (containingPost) addCopyButtons(containingPost);
            // Check if the added node is a post
            if (node.classList?.contains('topic-post') ||
                node.tagName === 'ARTICLE' ||
                node.classList?.contains('post')) {
              addCopyButtons(node);
            } else {
              // Check for posts within the added node
              const posts = node.querySelectorAll?.('.topic-post, article, .post');
              if (posts && posts.length > 0) {
                posts.forEach(post => addCopyButtons(post));
              }
            }
          }
        });
      });
    });

    ctx.onInvalidated(() => {
      observer.disconnect();
      clearTimeout(toastTimer);
      style.remove();
      toast.remove();
      document.querySelectorAll('.linux-do-copy-btn').forEach(button => button.remove());
    });

    // Start observing
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  },
});
