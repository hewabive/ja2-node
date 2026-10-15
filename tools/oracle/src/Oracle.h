// Links against Jagged Alliance 2 source code (Strategy First SFI-SCLA) via JA2 Stracciatella.
// Written for ja2-node as a native oracle harness, 2026-10-15. See LICENSE (SFI-SCLA).
// @src src/sgp/SGP.cc main
#pragma once

bool Oracle_IsRequested();
void Oracle_ConfigureLogging();
int Oracle_Run();
