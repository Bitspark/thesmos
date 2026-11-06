/* The C interface on its own: the header compiles as C, and a malformed proof denies with the
 * protocol's code. The C++ suite (receiver.cpp) covers the corpus and the adapter contract. */
#include <stdio.h>
#include <string.h>

#include "thesmos/thesmos.h"

int main(void) {
  static const uint8_t malformed[] = {0xff, 0x00};
  thesmos_value *root = thesmos_value_atom((const uint8_t *)"root", 4);
  thesmos_value *actor = thesmos_value_atom((const uint8_t *)"actor", 5);
  thesmos_bytes segment = {(const uint8_t *)"team", 4};
  thesmos_value *space = thesmos_path(&segment, 1);
  thesmos_value *statement = thesmos_fact("title", 5, NULL, 0);
  thesmos_verifier *verifier = thesmos_verifier_new_archon(root);
  thesmos_decision decision = {0};
  int ok = root && actor && space && statement && verifier &&
           thesmos_verify(verifier, actor, space, statement, malformed, sizeof malformed, &decision) &&
           !decision.permitted && decision.code.len == strlen("invalid-proof") &&
           memcmp(decision.code.data, "invalid-proof", decision.code.len) == 0;
  /* Null arguments are refused rather than read. */
  ok = ok && !thesmos_verify(NULL, actor, space, statement, malformed, sizeof malformed, &decision) &&
       thesmos_verifier_new(root, NULL, NULL) == NULL && thesmos_value_atom(NULL, 1) == NULL;
  thesmos_decision_free(&decision);
  thesmos_verifier_free(verifier);
  thesmos_value_free(statement);
  thesmos_value_free(space);
  thesmos_value_free(actor);
  thesmos_value_free(root);
  puts(ok ? "C interface smoke test passed" : "FAIL: C interface smoke test");
  return ok ? 0 : 1;
}
