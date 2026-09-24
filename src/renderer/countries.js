export const COUNTRIES = [
  {
    id: 'canada',
    label: 'Canada',
    languages: [
      { code: 'eng', label: 'English' },
      { code: 'fra', label: 'French' },
    ],
  },
  {
    id: 'belgium',
    label: 'Belgium',
    languages: [
      { code: 'nld', label: 'Dutch' },
      { code: 'fra', label: 'French' },
      { code: 'deu', label: 'German' },
    ],
  },
  {
    id: 'switzerland',
    label: 'Switzerland',
    languages: [
      { code: 'deu', label: 'German' },
      { code: 'fra', label: 'French' },
      { code: 'ita', label: 'Italian' },
    ],
  },
  {
    id: 'luxembourg',
    label: 'Luxembourg',
    languages: [
      { code: 'fra', label: 'French' },
      { code: 'deu', label: 'German' },
    ],
  },
  {
    id: 'finland',
    label: 'Finland',
    languages: [
      { code: 'fin', label: 'Finnish' },
      { code: 'swe', label: 'Swedish' },
    ],
  },
];

export function countryById(id) {
  return COUNTRIES.find((country) => country.id === id) || null;
}
