#include <iostream>

int main() {
    int n;
    std::cin >> n;

    int i = 0;
    while (i < n) {
        if (i % 2 == 0) {
            std::cout << i << " ";
        }
        i++;
    }

    do {
        n--;
    } while (n > 0);

    return 0;
}
