#include <hip/hip_runtime.h>
#include <iostream>

__global__ void hello_rocm() {
    printf("Hello from the AMD GPU! Thread ID: %d\n", threadIdx.x);
}

int main() {
    // Launch the kernel with 1 block and 5 threads
    hello_rocm<<<1, 5>>>();
    
    // Wait for the GPU to finish before exiting
    hipDeviceSynchronize();
    
    std::cout << "Kernel execution completed." << std::endl;
    return 0;
}