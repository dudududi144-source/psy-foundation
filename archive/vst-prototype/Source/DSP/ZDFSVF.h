/*
  =============================================================================
  ZDF SVF — Zero-Delay Feedback State-Variable Filter
  =============================================================================

  C++ port of the ZDF SVF from apps/web/src/lib/psy4/forensic/dsp.ts.
  Andrew Simper / Vadim Zavalishin topology.

  SPDX-License-Identifier: MIT
*/

#pragma once

#include <cmath>
#include <algorithm>

namespace psy4 {

class ZDFSVF
{
public:
    ZDFSVF() : ic1eq(0.0f), ic2eq(0.0f), lastCutoff(-1.0f), g(0.0f), k(0.0f) {}

    void reset()
    {
        ic1eq = 0.0f;
        ic2eq = 0.0f;
    }

    // Process one sample. type: 0=LP, 1=BP, 2=HP
    float process(float x, float cutoff, float resonance, float sr, int type = 0)
    {
        // Recompute coefficients when cutoff changes
        if (std::abs(cutoff - lastCutoff) > 0.5f) {
            float fc = std::min(0.45f, cutoff / sr);
            float tanVal = std::tan(M_PI * fc);
            g = tanVal;
            k = 2.0f - 2.0f * std::min(0.99f, resonance);
            lastCutoff = cutoff;
        }

        // ZDF SVF equations (Simper/Zavalishin)
        float a1 = 1.0f / (1.0f + g * (g + k));
        float a2 = g * a1;
        float a3 = g * a2;
        float v3 = x - ic2eq;
        float v1 = a1 * ic1eq + a2 * v3;
        float v2 = ic2eq + a2 * ic1eq + a3 * v3;
        ic1eq = 2.0f * v1 - ic1eq;
        ic2eq = 2.0f * v2 - ic2eq;

        // Output selection
        switch (type) {
            case 0: return v2;       // Lowpass
            case 1: return v1;       // Bandpass
            case 2: return x - k * v1 - v2; // Highpass
            default: return v2;     // Default to LP
        }
    }

private:
    float ic1eq, ic2eq;
    float lastCutoff, g, k;
};

} // namespace psy4
