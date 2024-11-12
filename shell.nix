{ pkgs ? import <nixpkgs> {} }:

pkgs.mkShell {

  packages = [ pkgs.python3 ];
}
