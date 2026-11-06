# The Spaces receiver for C and C++: thesmos's Rust receiver (core/rs) behind a C ABI.
#
#   add_subdirectory(thesmos/core/cpp)          # or FetchContent with SOURCE_SUBDIR core/cpp
#   target_link_libraries(app PRIVATE thesmos::thesmos)
#   #include <thesmos/thesmos.hpp>              # C++20; C uses <thesmos/thesmos.h>
#
# The library is built from source by Cargo through Corrosion. Like the Go module and the Rust
# crate, it needs read access to the private Bitspark/logos repository for Logos's Rust checker;
# release archives bundle no private dependency code.
cmake_minimum_required(VERSION 3.22)
project(thesmos VERSION 1.0.0 LANGUAGES C CXX)

include(FetchContent)
find_package(Corrosion 0.5 QUIET)
if(NOT Corrosion_FOUND)
  FetchContent_Declare(Corrosion
    GIT_REPOSITORY https://github.com/corrosion-rs/corrosion.git
    GIT_TAG a1a1aaa057a5da656c06c3d8505b767a4e941709  # v0.5.2, pinned by commit
    )
  FetchContent_MakeAvailable(Corrosion)
endif()

# The committed Cargo.lock is the dependency pin, as for core/rs.
corrosion_import_crate(
  MANIFEST_PATH ${CMAKE_CURRENT_SOURCE_DIR}/Cargo.toml
  CRATES bitspark-thesmos-capi
  CRATE_TYPES staticlib
  LOCKED)

add_library(thesmos INTERFACE)
add_library(thesmos::thesmos ALIAS thesmos)
target_include_directories(thesmos INTERFACE ${CMAKE_CURRENT_SOURCE_DIR}/include)
target_link_libraries(thesmos INTERFACE thesmos_capi)
target_compile_features(thesmos INTERFACE cxx_std_20)

option(THESMOS_BUILD_TESTS "Build the receiver tests" ${PROJECT_IS_TOP_LEVEL})
if(THESMOS_BUILD_TESTS)
  enable_testing()
  # Test-only: the frozen corpus authenticates with its public Ed25519 example keys.
  find_package(OpenSSL 3.0 REQUIRED)
  set(test_data "${CMAKE_CURRENT_SOURCE_DIR}/../rs/tests/data")

  find_package(Threads REQUIRED)
  add_executable(thesmos_receiver_tests tests/receiver.cpp)
  target_link_libraries(thesmos_receiver_tests PRIVATE thesmos::thesmos OpenSSL::Crypto Threads::Threads)
  target_compile_definitions(thesmos_receiver_tests PRIVATE THESMOS_TEST_DATA="${test_data}")
  add_test(NAME receiver COMMAND thesmos_receiver_tests)

  add_executable(thesmos_c_smoke tests/smoke.c)
  set_target_properties(thesmos_c_smoke PROPERTIES C_STANDARD 99 C_STANDARD_REQUIRED ON)
  target_link_libraries(thesmos_c_smoke PRIVATE thesmos::thesmos)
  add_test(NAME c_smoke COMMAND thesmos_c_smoke)

  if(MSVC)
    target_compile_options(thesmos_receiver_tests PRIVATE /W4 /WX)
  else()
    target_compile_options(thesmos_receiver_tests PRIVATE -Wall -Wextra -Wpedantic -Werror)
    target_compile_options(thesmos_c_smoke PRIVATE -Wall -Wextra -Wpedantic -Werror)
  endif()
endif()
