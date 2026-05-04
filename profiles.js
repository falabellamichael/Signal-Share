class ProfileUploader {
    constructor() {
        this.currentPage = 1;
        this.itemsPerPage = 9;
        this.allUploads = [];
        this.init();
    }

    init() {
        // Load uploads data
        this.loadUploads();
        
        // Set up event listeners
        this.setupEventListeners();
    }

    loadUploads() {
        // This would typically fetch from an API or database
        // For now, we'll simulate with sample data
        this.allUploads = [
            { id: 1, title: "Upload 1", date: "2023-01-01", type: "image" },
            { id: 2, title: "Upload 2", date: "2023-01-02", type: "image" },
            { id: 3, title: "Upload 3", date: "2023-01-03", type: "image" },
            { id: 4, title: "Upload 4", date: "2023-01-04", type: "image" },
            { id: 5, title: "Upload 5", date: "2023-01-05", type: "image" },
            { id: 6, title: "Upload 6", date: "2023-01-06", type: "image" },
            { id: 7, title: "Upload 7", date: "2023-01-07", type: "image" },
            { id: 8, title: "Upload 8", date: "2023-01-08", type: "image" },
            { id: 9, title: "Upload 9", date: "2023-01-09", type: "image" },
            { id: 10, title: "Upload 10", date: "2023-01-10", type: "image" },
            { id: 11, title: "Upload 11", date: "2023-01-11", type: "image" },
            { id: 12, title: "Upload 12", date: "2023-01-12", type: "image" },
            { id: 13, title: "Upload 13", date: "2023-01-13", type: "image" },
            { id: 14, title: "Upload 14", date: "2023-01-14", type: "image" },
            { id: 15, title: "Upload 15", date: "2023-01-15", type: "image" }
        ];

        // Display the first page
        this.displayUploads();
    }

    setupEventListeners() {
        // Handle pagination clicks
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('page-btn')) {
                const page = parseInt(e.target.dataset.page);
                this.goToPage(page);
            }
            
            if (e.target.classList.contains('prev-btn')) {
                this.goToPage(this.currentPage - 1);
            }
            
            if (e.target.classList.contains('next-btn')) {
                this.goToPage(this.currentPage + 1);
            }
        });
    }

    goToPage(page) {
        if (page < 1) page = 1;
        if (page > this.getTotalPages()) page = this.getTotalPages();
        
        this.currentPage = page;
        this.displayUploads();
        this.updatePaginationControls();
    }

    displayUploads() {
        const startIndex = (this.currentPage - 1) * this.itemsPerPage;
        const endIndex = startIndex + this.itemsPerPage;
        const currentUploads = this.allUploads.slice(startIndex, endIndex);

        // Clear current uploads
        const uploadsContainer = document.getElementById('uploads-container');
        if (uploadsContainer) {
            uploadsContainer.innerHTML = '';
            
            // Display uploads
            currentUploads.forEach(upload => {
                const uploadElement = this.createUploadElement(upload);
                uploadsContainer.appendChild(uploadElement);
            });
        }

        // Update pagination controls
        this.updatePaginationControls();
    }

    createUploadElement(upload) {
        const element = document.createElement('div');
        element.className = 'upload-item';
        element.innerHTML = `
            <div class="upload-content">
                <h3>${upload.title}</h3>
                <p>Date: ${upload.date}</p>
                <p>Type: ${upload.type}</p>
            </div>
        `;
        return element;
    }

    updatePaginationControls() {
        const totalPages = this.getTotalPages();
        
        // Update pagination controls
        const paginationContainer = document.getElementById('pagination-container');
        if (paginationContainer) {
            paginationContainer.innerHTML = this.generatePaginationHTML(totalPages);
        }
    }

    generatePaginationHTML(totalPages) {
        let html = '';
        
        // Previous button
        html += `<button class="prev-btn ${this.currentPage === 1 ? 'disabled' : ''}">Previous</button>`;
        
        // Page buttons
        for (let i = 1; i <= totalPages; i++) {
            html += `<button class="page-btn ${i === this.currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
        }
        
        // Next button
        html += `<button class="next-btn ${this.currentPage === totalPages ? 'disabled' : ''}">Next</button>`;
        
        return html;
    }

    getTotalPages() {
        return Math.ceil(this.allUploads.length / this.itemsPerPage);
    }

    // Method to add new uploads
    addUpload(upload) {
        this.allUploads.unshift(upload);
        // If we're on the first page and there's space, show it
        if (this.currentPage === 1 && this.allUploads.length <= this.itemsPerPage) {
            this.displayUploads();
        } else {
            // Otherwise, just update the pagination
            this.updatePaginationControls();
        }
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Create a new instance of the profile uploader
    const profileUploader = new ProfileUploader();
    
    // You can also expose it globally if needed for other scripts
    window.profileUploader = profileUploader;
});

// Export for use in other modules (if using ES6 modules)
export default ProfileUploader;
