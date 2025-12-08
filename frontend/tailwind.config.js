/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        cdai: {
          topbar: "#000000",
          sidebar: "#0B0B0B",
          chathistory: "#1A1A1A",
          footer: "#000000",
          loginfooter: "#000000",
          input: "#000000",
          messages: "#000000",
          body: "#111111",
          text: "#E0E0E0",
          accent: "#1E7CFF",
          border: "#1B1B1B"
        },
      },

      borderRadius: {
        cdai: "4px",
        none: "0px"
      },
    },
  },
  plugins: [],
};
