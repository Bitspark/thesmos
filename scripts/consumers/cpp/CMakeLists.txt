# A consumer of the C/C++ receiver, configured by scripts/consumers/run.sh: CMake's FetchContent
# builds core/cpp from one commit, as README.md shows with a release tag.
cmake_minimum_required(VERSION 3.22)
project(thesmos_consumer LANGUAGES CXX)

set(THESMOS_REV "" CACHE STRING "The thesmos commit to build")
set(THESMOS_VECTOR "" CACHE FILEPATH "The Archon vector, archon-document.ontos")
if(NOT THESMOS_REV OR NOT THESMOS_VECTOR)
  message(FATAL_ERROR "set THESMOS_REV and THESMOS_VECTOR")
endif()

include(FetchContent)
FetchContent_Declare(thesmos
  GIT_REPOSITORY https://github.com/Bitspark/thesmos.git
  GIT_TAG ${THESMOS_REV}
  SOURCE_SUBDIR core/cpp)
FetchContent_MakeAvailable(thesmos)

add_executable(thesmos_consumer main.cpp)
target_compile_features(thesmos_consumer PRIVATE cxx_std_20)
target_link_libraries(thesmos_consumer PRIVATE thesmos::thesmos)

enable_testing()
add_test(NAME archon COMMAND thesmos_consumer ${THESMOS_VECTOR})
