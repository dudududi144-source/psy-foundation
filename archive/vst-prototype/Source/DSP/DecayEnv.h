/*
  =============================================================================
  DecayEnv — Exponential Decay Envelope
  =============================================================================

  C++ port of DecayEnv from apps/web/src/lib/psy4/forensic/dsp.ts.

  SPDX-License-Identifier: MIT
*/

#pragma once

#include <cmath>

namespace psy4 {

class DecayEnv
{
public:
    DecayEnv() : t(0.0f), decay(0.3f), amp(0.0f) {}

    void reset() { t = 0.0f; }
    void trigger(float velocity) { t = 0.0f; amp = velocity; }
    void setDecay(float d) { decay = d; }

    float process(float sr)
    {
        t += 1.0f / sr;
        return std::exp(-t / decay) * amp;
    }

    float getAmp() const { return amp; }

private:
    float t, decay, amp;
};

} // namespace psy4
