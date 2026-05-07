/**
 * Create a seeded pseudo-random number generator using a simple LCG algorithm.
 * @param {string} seed - A string seed value
 * @returns {function} - A function that returns a pseudo-random number between 0 and 1
 */
function seededRandom(seed) {
  let s = 0;
  for (let i = 0; i < seed.length; i++) {
    s = (s * 31 + seed.charCodeAt(i)) & 0x7fffffff;
  }
  return function () {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}

/**
 * Shuffle an array using the provided RNG (Fisher-Yates algorithm).
 * Does not mutate the original array.
 * @param {Array} arr - The array to shuffle
 * @param {function} rng - A random number generator function returning [0, 1)
 * @returns {Array} - A new shuffled array
 */
function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

module.exports = { seededRandom, shuffle };
