// Haupt-App JavaScript
document.addEventListener('DOMContentLoaded', function() {
    // Tab-Navigation
    const tabButtons = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const targetTab = button.getAttribute('data-tab');
            
            // Alle Tabs deaktivieren
            tabButtons.forEach(btn => btn.classList.remove('active'));
            tabContents.forEach(content => content.classList.remove('active'));
            
            // Ziel-Tab aktivieren
            button.classList.add('active');
            document.getElementById(targetTab).classList.add('active');
        });
    });

    // Schedule-Filter
    const filterButtons = document.querySelectorAll('.filter-btn');
    
    filterButtons.forEach(button => {
        button.addEventListener('click', () => {
            const filter = button.getAttribute('data-filter');
            
            // Alle Filter-Buttons deaktivieren
            filterButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            
            // Schedule-Items filtern
            filterScheduleItems(filter);
        });
    });

    // Schedule-Items filtern
    function filterScheduleItems(filter) {
        const scheduleItems = document.querySelectorAll('.schedule-item');
        
        scheduleItems.forEach(item => {
            const phase = item.classList.contains('group') ? 'groups' : 
                         item.classList.contains('knockout') ? 'knockout' : 'all';
            
            if (filter === 'all' || phase === filter) {
                item.style.display = 'block';
            } else {
                item.style.display = 'none';
            }
        });
    }

    // Auto-Refresh für Live-Updates
    setInterval(() => {
        if (window.tournamentManager) {
            window.tournamentManager.updateUI();
        }
    }, 5000);

    // QR-Code für mobile Zugriffe
    generateQRCode();

    // Responsive Design Anpassungen
    handleResponsiveDesign();
});

// QR-Code generieren
function generateQRCode() {
    const currentUrl = window.location.href;
    
    // QR-Code Container erstellen (falls benötigt)
    const qrContainer = document.createElement('div');
    qrContainer.id = 'qr-code';
    qrContainer.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: white;
        padding: 10px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 1000;
        display: none;
    `;
    
    // QR-Code Text
    qrContainer.innerHTML = `
        <div style="text-align: center; font-size: 12px; margin-bottom: 5px;">
            QR-Code für Teams
        </div>
        <div style="font-size: 10px; word-break: break-all; max-width: 150px;">
            ${currentUrl}
        </div>
    `;
    
    document.body.appendChild(qrContainer);
    
    // QR-Code Toggle Button
    const qrToggle = document.createElement('button');
    qrToggle.innerHTML = '<i class="fas fa-qrcode"></i>';
    qrToggle.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #1e3c72;
        color: white;
        border: none;
        border-radius: 50%;
        width: 50px;
        height: 50px;
        font-size: 20px;
        cursor: pointer;
        z-index: 1001;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    `;
    
    qrToggle.addEventListener('click', () => {
        qrContainer.style.display = qrContainer.style.display === 'none' ? 'block' : 'none';
    });
    
    document.body.appendChild(qrToggle);
}

// Responsive Design
function handleResponsiveDesign() {
    const isMobile = window.innerWidth <= 768;
    
    if (isMobile) {
        // Mobile-spezifische Anpassungen
        document.body.classList.add('mobile');
        
        // Touch-Gesten für Tabs
        let startX = 0;
        let currentTabIndex = 0;
        
        document.addEventListener('touchstart', (e) => {
            startX = e.touches[0].clientX;
        });
        
        document.addEventListener('touchend', (e) => {
            const endX = e.changedTouches[0].clientX;
            const diff = startX - endX;
            
            if (Math.abs(diff) > 50) { // Mindest-Swipe-Distanz
                const tabButtons = document.querySelectorAll('.tab-btn');
                
                if (diff > 0 && currentTabIndex < tabButtons.length - 1) {
                    // Swipe nach links
                    currentTabIndex++;
                } else if (diff < 0 && currentTabIndex > 0) {
                    // Swipe nach rechts
                    currentTabIndex--;
                }
                
                tabButtons[currentTabIndex].click();
            }
        });
    }
}

// Service Worker für Offline-Funktionalität
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(registration => {
                console.log('SW registered: ', registration);
            })
            .catch(registrationError => {
                console.log('SW registration failed: ', registrationError);
            });
    });
}

// PWA Manifest
const manifest = {
    name: 'Oestereiden Juxturnier 2025',
    short_name: 'Juxturnier',
    description: 'Live-Score und Turnierplan für das Oestereiden Juxturnier',
    start_url: '/',
    display: 'standalone',
    background_color: '#1e3c72',
    theme_color: '#1e3c72',
    icons: [
        {
            src: 'Bilder/VollisderKegel-Logo.png',
            sizes: '192x192',
            type: 'image/png'
        }
    ]
};

// Manifest hinzufügen
const manifestLink = document.createElement('link');
manifestLink.rel = 'manifest';
manifestLink.href = 'data:application/json,' + encodeURIComponent(JSON.stringify(manifest));
document.head.appendChild(manifestLink);

// Performance-Optimierungen
function optimizePerformance() {
    // Lazy Loading für Bilder
    const images = document.querySelectorAll('img');
    const imageObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const img = entry.target;
                img.src = img.dataset.src;
                img.classList.remove('lazy');
                observer.unobserve(img);
            }
        });
    });
    
    images.forEach(img => {
        if (img.dataset.src) {
            imageObserver.observe(img);
        }
    });
    
    // Debouncing für häufige Updates
    let updateTimeout;
    const debouncedUpdate = (func, delay = 1000) => {
        clearTimeout(updateTimeout);
        updateTimeout = setTimeout(func, delay);
    };
    
    // Live-Updates optimieren
    if (window.tournamentManager) {
        const originalUpdateUI = window.tournamentManager.updateUI;
        window.tournamentManager.updateUI = () => {
            debouncedUpdate(originalUpdateUI.bind(window.tournamentManager));
        };
    }
}

// Performance-Optimierungen starten
optimizePerformance();

// Error Handling
window.addEventListener('error', (e) => {
    console.error('Application Error:', e.error);
    
    // Benutzerfreundliche Fehlermeldung
    const errorDiv = document.createElement('div');
    errorDiv.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: #ff6b6b;
        color: white;
        padding: 20px;
        border-radius: 8px;
        z-index: 10000;
        text-align: center;
    `;
    errorDiv.innerHTML = `
        <h3>Ein Fehler ist aufgetreten</h3>
        <p>Bitte laden Sie die Seite neu.</p>
        <button onclick="location.reload()" style="
            background: white;
            color: #ff6b6b;
            border: none;
            padding: 10px 20px;
            border-radius: 5px;
            cursor: pointer;
            margin-top: 10px;
        ">Seite neu laden</button>
    `;
    
    document.body.appendChild(errorDiv);
    
    // Automatisch nach 10 Sekunden entfernen
    setTimeout(() => {
        if (errorDiv.parentNode) {
            errorDiv.parentNode.removeChild(errorDiv);
        }
    }, 10000);
});

// Keyboard-Navigation
document.addEventListener('keydown', (e) => {
    // Tab-Navigation mit Pfeiltasten
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const activeTab = document.querySelector('.tab-btn.active');
        const tabButtons = document.querySelectorAll('.tab-btn');
        const currentIndex = Array.from(tabButtons).indexOf(activeTab);
        
        let newIndex;
        if (e.key === 'ArrowLeft') {
            newIndex = currentIndex > 0 ? currentIndex - 1 : tabButtons.length - 1;
        } else {
            newIndex = currentIndex < tabButtons.length - 1 ? currentIndex + 1 : 0;
        }
        
        tabButtons[newIndex].click();
    }
    
    // Escape-Taste für QR-Code schließen
    if (e.key === 'Escape') {
        const qrCode = document.getElementById('qr-code');
        if (qrCode) {
            qrCode.style.display = 'none';
        }
    }
});

// Accessibility-Verbesserungen
function improveAccessibility() {
    // ARIA-Labels hinzufügen
    const tabButtons = document.querySelectorAll('.tab-btn');
    tabButtons.forEach((button, index) => {
        button.setAttribute('aria-label', `Tab ${index + 1}: ${button.textContent}`);
        button.setAttribute('role', 'tab');
    });
    
    // Skip-Links für Screen Reader
    const skipLink = document.createElement('a');
    skipLink.href = '#main-content';
    skipLink.textContent = 'Zum Hauptinhalt springen';
    skipLink.style.cssText = `
        position: absolute;
        top: -40px;
        left: 6px;
        background: #1e3c72;
        color: white;
        padding: 8px;
        text-decoration: none;
        border-radius: 4px;
        z-index: 10000;
    `;
    skipLink.addEventListener('focus', () => {
        skipLink.style.top = '6px';
    });
    skipLink.addEventListener('blur', () => {
        skipLink.style.top = '-40px';
    });
    
    document.body.insertBefore(skipLink, document.body.firstChild);
    
    // Hauptinhalt ID hinzufügen
    const main = document.querySelector('main');
    if (main) {
        main.id = 'main-content';
    }
}

// Accessibility-Verbesserungen starten
improveAccessibility(); 