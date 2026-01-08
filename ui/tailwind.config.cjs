//** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: "var(--primary-color)",
        "primary-dark": "var(--primary-dark)",
        secondary: "var(--secondary-color)",
        "text-primary": "var(--text-primary)",
        "text-secondary": "var(--text-secondary)",
        border: "var(--border-color)",
        success: "var(--success-color)",
        warning: "var(--warning-color)",
        error: "var(--error-color)"
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "Roboto", "Helvetica", "Arial", "sans-serif"]
      },
      keyframes: {
        toastIn: {
          "0%": { transform: "translateX(100%)", opacity: "0" },
          "100%": { transform: "translateX(0)", opacity: "1" }
        },
        toastOut: {
          "0%": { transform: "translateX(0)", opacity: "1" },
          "100%": { transform: "translateX(100%)", opacity: "0" }
        }
      },
      animation: {
        toastIn: "toastIn 0.2s ease-out",
        toastOut: "toastOut 0.2s ease-in"
      }
    }
  },
  plugins: []
};
