/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/**/*.{js,jsx,html}'],
  theme: {
    extend: {
      colors: {
        paper: '#FFFFFF',
        ink: '#000000',
        pine: '#1A281F',
        coral: '#FA9A66',
        lilac: '#CDB7FF',
        lime: '#D2FFA0',
        sand: '#D2CFC5',
      },
      fontFamily: {
        sans: ['"Segoe UI"', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
