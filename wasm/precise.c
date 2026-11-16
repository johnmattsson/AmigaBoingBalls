// =============================================================================
// precise.c — the extended-precision arithmetic of precise.js, compiled to
// WebAssembly (see build.sh), where it runs several times faster.
//
// Operation for operation the same as the JavaScript in precise.js, so the
// results are identical to the last bit (no fused multiply-add: built with
// -ffp-contract=off). The digits of the numbers come in as arguments and the
// result is left in `res`, so no numbers have to live in WebAssembly's memory.
//
// Only the 64-digit arithmetic: quad-double, 4 parts (the QD library by
// Hida, Li and Bailey). (For 32 digits it made no difference; see precise.js.)
// =============================================================================
static double err;
static inline double twoSum(double a, double b) { double s = a + b, v = s - a; err = (a - (s - v)) + (b - v); return s; }
static const double SPLIT = 134217729.0;
static inline double twoProduct(double a, double b) {
  double p = a * b, t = SPLIT * a;
  double a1 = t - (t - a), a2 = a - a1;
  t = SPLIT * b;
  double b1 = t - (t - b), b2 = b - b1;
  err = ((a1 * b1 - p) + a1 * b2 + a2 * b1) + a2 * b2;
  return p;
}
static inline double quickTwoSum(double a, double b) { double s = a + b; err = b - (s - a); return s; }
static double r0, r1, r2, r3;
static inline void renorm(double c0, double c1, double c2, double c3, double c4) {
  double s0, s1 = 0, s2 = 0, s3 = 0;
  s0 = quickTwoSum(c3, c4); c4 = err;
  s0 = quickTwoSum(c2, s0); c3 = err;
  s0 = quickTwoSum(c1, s0); c2 = err;
  c0 = quickTwoSum(c0, s0); c1 = err;
  s0 = c0; s1 = c1;
  s0 = quickTwoSum(c0, c1); s1 = err;
  if (s1 != 0) {
    s1 = quickTwoSum(s1, c2); s2 = err;
    if (s2 != 0) { s2 = quickTwoSum(s2, c3); s3 = err; if (s3 != 0) s3 += c4; else s2 += c4; }
    else { s1 = quickTwoSum(s1, c3); s2 = err;
      if (s2 != 0) { s2 = quickTwoSum(s2, c4); s3 = err; } else { s1 = quickTwoSum(s1, c4); s2 = err; } }
  } else {
    s0 = quickTwoSum(s0, c2); s1 = err;
    if (s1 != 0) { s1 = quickTwoSum(s1, c3); s2 = err;
      if (s2 != 0) { s2 = quickTwoSum(s2, c4); s3 = err; } else { s1 = quickTwoSum(s1, c4); s2 = err; } }
    else { s0 = quickTwoSum(s0, c3); s1 = err;
      if (s1 != 0) { s1 = quickTwoSum(s1, c4); s2 = err; } else { s0 = quickTwoSum(s0, c4); s1 = err; } }
  }
  r0 = s0; r1 = s1; r2 = s2; r3 = s3;
}
static inline void addParts(double *out, double a0, double a1, double a2, double a3, double b0, double b1, double b2, double b3) {
  double s0 = twoSum(a0, b0), t0 = err;
  double s1 = twoSum(a1, b1), t1 = err;
  double s2 = twoSum(a2, b2), t2 = err;
  double s3 = twoSum(a3, b3), t3 = err;
  s1 = twoSum(s1, t0); t0 = err;
  double u1 = twoSum(s2, t0), u2 = err;
  s2 = twoSum(t1, u1); double u3 = err;
  t0 = twoSum(u2, u3); t1 = err;
  u1 = twoSum(s3, t0); u2 = err;
  s3 = twoSum(t2, u1); u3 = err;
  t0 = u2 + u3;
  t0 = t0 + t1 + t3;
  renorm(s0, s1, s2, s3, t0);
  out[0] = r0; out[1] = r1; out[2] = r2; out[3] = r3;
}
static inline void qdMul(double *out, const double *a, const double *b) {
  double p0 = twoProduct(a[0], b[0]), q0 = err;
  double p1 = twoProduct(a[0], b[1]), q1 = err;
  double p2 = twoProduct(a[1], b[0]), q2 = err;
  double p3 = twoProduct(a[0], b[2]), q3 = err;
  double p4 = twoProduct(a[1], b[1]), q4 = err;
  double p5 = twoProduct(a[2], b[0]), q5 = err;
  double t1 = twoSum(p1, p2), t2 = err;
  p1 = twoSum(q0, t1); double t3 = err;
  p2 = twoSum(t2, t3); double c = err;
  t1 = twoSum(p2, q1); t2 = err; p2 = twoSum(q2, t1); t3 = err; q1 = twoSum(t2, t3); q2 = err;
  t1 = twoSum(p3, p4); t2 = err; p3 = twoSum(p5, t1); t3 = err; p4 = twoSum(t2, t3); p5 = err;
  double s0 = twoSum(p2, p3), e0 = err;
  double s1 = twoSum(q1, p4), e1 = err;
  double s2 = q2 + p5;
  s1 = twoSum(s1, e0); e0 = err;
  s2 += e0 + e1;
  s1 += a[0] * b[3] + a[1] * b[2] + a[2] * b[1] + a[3] * b[0] + c + q3 + q4 + q5;
  renorm(p0, p1, s0, s1, s2);
  out[0] = r0; out[1] = r1; out[2] = r2; out[3] = r3;
}

static double res[4];
__attribute__((export_name("res"))) double *resPointer(void) { return res; }

// ---- 64 digits ----
__attribute__((export_name("qdAdd"))) void qdAdd(double a0, double a1, double a2, double a3,
                                                double b0, double b1, double b2, double b3) {
  addParts(res, a0, a1, a2, a3, b0, b1, b2, b3);
}
__attribute__((export_name("qdMul"))) void qdMulExport(double a0, double a1, double a2, double a3,
                                                      double b0, double b1, double b2, double b3) {
  double a[4] = { a0, a1, a2, a3 }, b[4] = { b0, b1, b2, b3 };
  qdMul(res, a, b);
}
__attribute__((export_name("qdScale"))) void qdScale(double a0, double a1, double a2, double a3, double x) {
  double p0 = twoProduct(a0, x), q0 = err;
  double p1 = twoProduct(a1, x), q1 = err;
  double p2 = twoProduct(a2, x), q2 = err;
  double p3 = a3 * x;
  double s0 = p0;
  double s1 = twoSum(q0, p1), s2 = err;
  double t1 = twoSum(s2, q1), t2 = err;
  s2 = twoSum(p2, t1); double t3 = err;
  double u1 = twoSum(t2, t3), u2 = err;
  t1 = twoSum(u1, q2); t2 = err;
  double s3 = twoSum(p3, t1); t3 = err;
  double s4 = t2 + t3 + u2;
  renorm(s0, s1, s2, s3, s4);
  res[0] = r0; res[1] = r1; res[2] = r2; res[3] = r3;
}
