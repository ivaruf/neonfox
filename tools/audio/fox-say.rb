# fox-say.rb — the phrase the winning fox says: "ring ding ding ding ding".
#
# A tribute to the obvious song, and deliberately NOT its melody: the joke is
# that a fox has something to say, so what matters is that this reads as
# SPEECH rather than as a tune. Five clean notes sound like a music box; the
# difference is formants.
#
# How a syllable is built here:
#   - a saw, because a vowel needs harmonics for the filters to carve;
#   - three resonant band-pass copies of it at the formant frequencies of the
#     "i" in ring/ding (about 400, 1900 and 2550 Hz), summed;
#   - each syllable in two halves — the open vowel, then a darker, quieter
#     half with the upper formants pulled down, which is the "-ng" closing;
#   - a gap and a tick of noise in front of every "d", because a stop
#     consonant is mostly the silence before it.
#
# Pitch falls across the phrase and drops on the last syllable, the way a
# spoken sentence ends. Render with ../tools/audio/render.rb (hub CLAUDE.md
# §9), then encode with tools/audio/encode-oneshots.mjs.

use_bpm 60 # one beat is one second, so every number below is seconds

# Formants of the vowel, then of the nasal it closes onto.
VOWEL = [400, 1900, 2550]
NASAL = [300, 1100, 2000]
WEIGHT = [1.0, 0.55, 0.28] # upper formants sit under the first

define :formants do |pitch, dur, freqs, amp|
  # Three filtered copies of one saw, played at the same logical time: Sonic
  # Pi only advances time on sleep, so these stack rather than queue.
  freqs.each_with_index do |f, i|
    with_fx :rbpf, centre: hz_to_midi(f), res: 0.93, amp: amp * WEIGHT[i] do
      synth :saw, note: pitch, attack: 0.004, sustain: dur * 0.7,
        release: dur * 0.3, amp: 1.1, cutoff: 120
    end
  end
end

define :syllable do |pitch, dur, plosive, amp|
  if plosive
    sleep 0.028 # the gap that makes a "d" a "d"
    with_fx :rhpf, centre: hz_to_midi(1500), res: 0.4, amp: 0.5 do
      synth :noise, attack: 0.001, sustain: 0.002, release: 0.004, amp: amp
    end
  end
  open = dur * 0.58
  close = dur * 0.42
  formants pitch, open, VOWEL, amp
  # Start the nasal before the vowel has finished releasing. Waiting the full
  # `open` leaves a dip in the middle of the syllable, and a dip inside one
  # syllable is heard as two.
  sleep open * 0.82
  formants pitch - 1, close, NASAL, amp * 0.42 # the "-ng"
  sleep close
end

# ring  ding  ding  ding  ding — rising through the middle, landing low.
# Pitches are scale degrees, not a quotation of anything.
# Spoken briskly: about 150 ms a syllable, which is patter rather than melody.
PHRASE = [
  [:e4, 0.15, false, 1.0],
  [:fs4, 0.11, true, 0.95],
  [:fs4, 0.11, true, 0.95],
  [:gs4, 0.11, true, 0.95],
  [:cs4, 0.28, true, 0.9],
]

with_fx :reverb, room: 0.35, mix: 0.18 do
  PHRASE.each do |pitch, dur, plosive, amp|
    syllable note(pitch), dur, plosive, amp
    sleep 0.018 # a breath between syllables, not a rest
  end
end
