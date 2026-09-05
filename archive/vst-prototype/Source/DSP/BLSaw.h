/*
  =============================================================================
  BLSaw — Band-Limited Sawtooth Oscillator with PolyBLEP
  =============================================================================

  C++ port of BLSaw from apps/web/src/lib/psy4/forensic/dsp.ts.
  PolyBLEP correction reduces aliasing above Nyquist.

  SPDX-License-Identifier: MIT
*/

#pragma once

#include <cmath>

namespace psy4 {

class BLSaw
{
public:
    BLSaw() : phase(0.0f), lastPhase(0.0f) {}

    void reset()
    {
        phase = 0.0f;
        lastPhase = 0.0f;
    }

    // Process one sample. inc = freq / sampleRate
    float process(float inc)
    {
        lastPhase = phase;
        phase += inc;

        float blep = 0.0f;
        if (phase >= 1.0f) {
            phase -= 1.0f;
            // PolyBLEP correction at the discontinuity
            float dt = inc;
            float t = phase / dt;
            blep = -t * t * (1.0f - t) * 0.5f * dt * 4.0f;
        }

        // Naive sawtooth + polyBLEP correction
        float saw = 2.0f * lastPhase - 1.0f;
        return saw + blep;
    }

private:
    float phase, lastPhase;
};

} // namespace psy4
